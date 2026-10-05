import { mkdir, readdir, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import { join, posix } from "node:path";
import type { Readable } from "node:stream";
import type { Config, Logger } from "../config.js";
import { OkfError } from "../errors.js";
import { nowIso } from "../okf/frontmatter.js";
import { PROJECT_RE } from "../okf/paths.js";
import type {
  BundleSource,
  CommitSpec,
  HistoryEntry,
  ResyncHandler,
  StorageBackend,
  StorageTx,
  SyncStatus,
  TransactionResult,
} from "./backend.js";
import type { BundleTree } from "./bundle.js";
import { atomicWrite, isDirectory, listTreeFiles, pathExists } from "./fs-util.js";
import { Git, isPushRejection, redactRemote } from "./git.js";
import { Mutex } from "./mutex.js";
import { PathIndex } from "./path-index.js";

function extractChangedProjects(diffOutput: string): string[] {
  const lines = diffOutput
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const projects = new Set<string>();
  for (const line of lines) {
    const firstSegment = line.split("/")[0];
    if (firstSegment && PROJECT_RE.test(firstSegment)) {
      projects.add(firstSegment);
    }
  }
  return Array.from(projects);
}

/** Mutations against the working tree; keeps the path index in step with disk. */
class GitTx implements StorageTx {
  touched = false;

  constructor(
    private readonly repoDir: string,
    private readonly index: PathIndex,
  ) {}

  async writeFile(project: string, path: string, content: string | Buffer): Promise<void> {
    await atomicWrite(join(this.repoDir, project, path), content);
    this.index.add(project, path);
    this.touched = true;
  }

  async deleteFile(project: string, path: string): Promise<void> {
    const projectDir = join(this.repoDir, project);
    await rm(join(projectDir, path), { force: true });
    let dir = posix.dirname(path);
    while (dir !== "." && dir !== "") {
      const abs = join(projectDir, dir);
      try {
        if ((await readdir(abs)).length > 0) {
          break;
        }
        await rmdir(abs);
      } catch {
        break;
      }
      dir = posix.dirname(dir);
    }
    this.index.remove(project, path);
    this.touched = true;
  }

  async deleteProject(project: string): Promise<void> {
    await rm(join(this.repoDir, project), { recursive: true, force: true });
    this.index.setProject(project, []);
    this.touched = true;
  }

  async replaceProject(project: string, source: BundleSource): Promise<void> {
    const projectDir = join(this.repoDir, project);
    await rm(projectDir, { recursive: true, force: true });
    const written: string[] = [];
    for (const path of source.paths) {
      const content = await source.read(path);
      if (content !== null) {
        await atomicWrite(join(projectDir, path), content);
        written.push(path);
      }
    }
    this.index.setProject(project, written);
    this.touched = true;
  }
}

export class GitBackend implements StorageBackend {
  readonly config: Config;
  readonly log: Logger;
  readonly repoDir: string;
  readonly homeDir: string;
  readonly git: Git;
  private readonly mutex = new Mutex();
  private readonly index = new PathIndex();

  private resyncHandler: ResyncHandler | null = null;
  private lastSyncAt: string | null = null;
  private lastError: string | null = null;

  constructor(config: Config, log: Logger, repoDir: string, homeDir: string) {
    this.config = config;
    this.log = log;
    this.repoDir = repoDir;
    this.homeDir = homeDir;
    this.git = new Git(repoDir, homeDir, config);
  }

  get hasRemote(): boolean {
    return Boolean(this.config.gitRemoteUrl && this.config.gitRemoteUrl.trim().length > 0);
  }

  setResyncHandler(handler: ResyncHandler): void {
    this.resyncHandler = handler;
  }

  async close(): Promise<void> {
    await this.mutex.idle();
  }

  async projects(): Promise<string[]> {
    return this.index.projects();
  }

  async tree(project: string): Promise<BundleTree> {
    return this.index.tree(project);
  }

  async readFile(project: string, path: string): Promise<Buffer | null> {
    if (!this.index.tree(project).hasFile(path)) {
      return null;
    }
    try {
      return await readFile(join(this.repoDir, project, path));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw err;
    }
  }

  private async reindexProject(project: string): Promise<void> {
    const dir = join(this.repoDir, project);
    const paths = (await isDirectory(dir)) ? await listTreeFiles(dir) : [];
    this.index.setProject(project, paths);
  }

  private async reindexAll(): Promise<void> {
    this.index.clear();
    const entries = await readdir(this.repoDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") || !entry.isDirectory()) {
        continue;
      }
      if (PROJECT_RE.test(entry.name)) {
        await this.reindexProject(entry.name);
      } else {
        this.log.warn(`Ignoring non-matching directory "${entry.name}" in repository root`);
      }
    }
  }

  /** Reindexes projects whose stored content changed underneath the service and lets the handler catch up. */
  private async resync(projects: string[]): Promise<void> {
    for (const project of new Set(projects)) {
      await this.reindexProject(project);
      if (!this.resyncHandler) {
        continue;
      }
      const tx = new GitTx(this.repoDir, this.index);
      await this.resyncHandler(project, tx);
      if (tx.touched) {
        await this.commitInternal(
          `okf(${project}): regenerate indexes`,
          "process:ok-fine",
          { subject: "system", clientId: "ok-fine" },
          [project],
        );
      }
    }
  }

  static async open(config: Config, log: Logger): Promise<GitBackend> {
    const repoDir = join(config.dataDir, "repo");
    const homeDir = join(config.dataDir, "home");

    await mkdir(repoDir, { recursive: true });
    await mkdir(homeDir, { recursive: true });

    const repo = new GitBackend(config, log, repoDir, homeDir);
    await repo.git.prepareSsh();

    // Check if git initialized
    const gitDirExists = await pathExists(join(repoDir, ".git"));
    if (!gitDirExists) {
      await repo.git.run(["init", "-b", config.gitBranch]);
    }

    const headRev = await repo.git.run(["rev-parse", "--verify", "HEAD"], { allowFail: true });
    let headHasCommits = headRev.code === 0;

    if (repo.hasRemote && config.gitRemoteUrl) {
      const remotes = await repo.git.run(["remote"], { allowFail: true });
      const remoteList = remotes.stdout.split(/\r?\n/).map((r) => r.trim());
      if (remoteList.includes("origin")) {
        await repo.git.run(["remote", "set-url", "origin", config.gitRemoteUrl]);
      } else {
        await repo.git.run(["remote", "add", "origin", config.gitRemoteUrl]);
      }

      const fetchRes = await repo.git.run(["fetch", "origin", config.gitBranch], { allowFail: true });
      if (fetchRes.code !== 0) {
        const isRefNotFound = fetchRes.stderr.includes("couldn't find remote ref");
        if (!isRefNotFound) {
          if (!headHasCommits) {
            throw new Error(`Failed to fetch from remote on empty local repository:\n${fetchRes.stderr}`);
          } else {
            log.warn({ stderr: fetchRes.stderr }, "Fetch failed on startup; continuing with local commits");
          }
        }
      }

      const remoteBranchRev = await repo.git.run(["rev-parse", "--verify", `origin/${config.gitBranch}`], {
        allowFail: true,
      });
      const remoteBranchExists = remoteBranchRev.code === 0;

      if (!headHasCommits) {
        if (remoteBranchExists) {
          await repo.git.run(["checkout", "-B", config.gitBranch, `origin/${config.gitBranch}`]);
          headHasCommits = true;
        } else {
          // Initialize empty bundle root files
          await repo.ensureAttributesAndIgnore();
          await repo.git.run([
            "commit",
            "--author=process:ok-fine <ok-fine@localhost>",
            "-m",
            "okf: initialize knowledge repository",
          ]);
          await repo.git.run(["push", "-u", "origin", `${config.gitBranch}:${config.gitBranch}`], {
            allowFail: true,
          });
          headHasCommits = true;
        }
      } else {
        await repo.sync();
      }
    } else {
      if (!headHasCommits) {
        await repo.ensureAttributesAndIgnore();
        await repo.git.run([
          "commit",
          "--author=process:ok-fine <ok-fine@localhost>",
          "-m",
          "okf: initialize knowledge repository",
        ]);
        headHasCommits = true;
      }
    }

    // Ensure .gitattributes and .gitignore exist with required lines
    const attrChanged = await repo.ensureAttributesAndIgnore();
    if (attrChanged) {
      await repo.git.run(["add", ".gitattributes", ".gitignore"]);
      const diffCheck = await repo.git.run(["diff", "--cached", "--quiet"], { allowFail: true });
      if (diffCheck.code !== 0) {
        await repo.git.run([
          "commit",
          "--author=process:ok-fine <ok-fine@localhost>",
          "-m",
          "okf: configure merge and ignore attributes",
        ]);
        if (repo.hasRemote) {
          await repo.git.run(["push", "origin", `HEAD:refs/heads/${config.gitBranch}`], {
            allowFail: true,
          });
        }
      }
    }

    await repo.reindexAll();
    return repo;
  }

  private async ensureAttributesAndIgnore(): Promise<boolean> {
    let changed = false;

    const gitattributesPath = join(this.repoDir, ".gitattributes");
    let attrContent = "";
    try {
      attrContent = await readFile(gitattributesPath, "utf8");
    } catch {
      // not exists
    }

    const requiredAttrLines = ["**/index.md merge=union", "**/log.md merge=union"];

    let newAttrContent = attrContent;
    for (const line of requiredAttrLines) {
      if (!newAttrContent.includes(line)) {
        if (newAttrContent.length > 0 && !newAttrContent.endsWith("\n")) {
          newAttrContent += "\n";
        }
        newAttrContent += `${line}\n`;
      }
    }

    if (newAttrContent !== attrContent) {
      await writeFile(gitattributesPath, newAttrContent, "utf8");
      await this.git.run(["add", ".gitattributes"]);
      changed = true;
    }

    const gitignorePath = join(this.repoDir, ".gitignore");
    let ignoreContent = "";
    try {
      ignoreContent = await readFile(gitignorePath, "utf8");
    } catch {
      // not exists
    }

    const requiredIgnoreLine = ".*.tmp";
    let newIgnoreContent = ignoreContent;
    if (!newIgnoreContent.includes(requiredIgnoreLine)) {
      if (newIgnoreContent.length > 0 && !newIgnoreContent.endsWith("\n")) {
        newIgnoreContent += "\n";
      }
      newIgnoreContent += `${requiredIgnoreLine}\n`;
    }

    if (newIgnoreContent !== ignoreContent) {
      await writeFile(gitignorePath, newIgnoreContent, "utf8");
      await this.git.run(["add", ".gitignore"]);
      changed = true;
    }

    return changed;
  }

  private async commitInternal(
    subject: string,
    author: string,
    principal: { subject: string; clientId: string },
    projects: string[],
  ): Promise<string | null> {
    const addArgs = projects.length > 0 ? ["add", "-A", "--", ...projects] : ["add", "-A"];
    await this.git.run(addArgs);

    const diffCheck = await this.git.run(["diff", "--cached", "--quiet"], { allowFail: true });
    if (diffCheck.code === 0) {
      return null;
    }

    await this.git.run([
      "commit",
      `--author=${author} <ok-fine@localhost>`,
      "-m",
      subject,
      "-m",
      `Okf-Principal: sub=${principal.subject} client=${principal.clientId}`,
    ]);

    const rev = await this.git.run(["rev-parse", "HEAD"]);
    return rev.stdout.trim();
  }

  /**
   * Aborts a failed rebase, keeps the original local commits on `ok-fine/conflict-<stamp>` (always as a
   * local branch, plus on the remote when the push succeeds), then resets to the remote branch.
   * Returns a human-readable description of where the commits were preserved.
   */
  private async preserveConflict(): Promise<string> {
    await this.git.run(["rebase", "--abort"], { allowFail: true });
    const stamp = new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}/, "")
      .replace(/Z$/, "Z");
    const conflictBranch = `ok-fine/conflict-${stamp}`;

    // The local branch keeps the commits reachable on the PVC even if the remote push fails.
    await this.git.run(["branch", "-f", conflictBranch, "HEAD"]);
    const pushRes = await this.git.run(
      ["push", "origin", `refs/heads/${conflictBranch}:refs/heads/${conflictBranch}`],
      { allowFail: true },
    );
    await this.git.run(["reset", "--hard", `origin/${this.config.gitBranch}`]);

    let message = `local commits preserved on ${conflictBranch}`;
    if (pushRes.code !== 0) {
      const reason = pushRes.stderr.trim().split("\n")[0] ?? "";
      message += ` (local branch only; pushing it failed: ${reason})`;
    }
    this.log.error({ stderr: pushRes.code !== 0 ? pushRes.stderr : undefined }, `rebase conflict; ${message}`);
    return message;
  }

  async transaction<T>(
    spec: { projects: string[] },
    work: (tx: StorageTx) => Promise<{ value: T; commit: CommitSpec | null }>,
  ): Promise<TransactionResult<T>> {
    return this.mutex.run(async () => {
      const warnings: string[] = [];

      // Step 1: Remote sync check before work
      if (this.hasRemote) {
        const fetchRes = await this.git.run(["fetch", "origin", this.config.gitBranch], { allowFail: true });

        if (fetchRes.code !== 0) {
          const firstLine = fetchRes.stderr.split(/\r?\n/)[0] ?? "unknown error";
          warnings.push(`remote unreachable: ${firstLine}`);
        } else {
          const behindRes = await this.git.run(["rev-list", "--count", `HEAD..origin/${this.config.gitBranch}`], {
            allowFail: true,
          });
          const behind = Number.parseInt(behindRes.stdout.trim(), 10) || 0;

          if (behind > 0) {
            const before = (await this.git.run(["rev-parse", "HEAD"])).stdout.trim();
            const rebaseRes = await this.git.run(["rebase", `origin/${this.config.gitBranch}`], { allowFail: true });

            if (rebaseRes.code !== 0) {
              warnings.push(await this.preserveConflict());
            }
            const after = (await this.git.run(["rev-parse", "HEAD"])).stdout.trim();
            if (before !== after) {
              const diffRes = await this.git.run(["diff", "--name-only", before, after]);
              await this.resync(extractChangedProjects(diffRes.stdout));
            }
          }
        }
      }

      // Step 2 & 3: Run work and commit
      try {
        const workRes = await work(new GitTx(this.repoDir, this.index));

        let commitSha: string | null = null;
        if (workRes.commit) {
          const addArgs = spec.projects.length > 0 ? ["add", "-A", "--", ...spec.projects] : ["add", "-A"];
          await this.git.run(addArgs);

          const diffCheck = await this.git.run(["diff", "--cached", "--quiet"], { allowFail: true });
          if (diffCheck.code !== 0) {
            const c = workRes.commit;
            const commitArgs = ["commit", `--author=${c.author} <ok-fine@localhost>`, "-m", c.subject];
            if (c.body && c.body.trim().length > 0) {
              commitArgs.push("-m", c.body);
            }
            commitArgs.push("-m", `Okf-Principal: sub=${c.principal.subject} client=${c.principal.clientId}`);
            await this.git.run(commitArgs);
            commitSha = (await this.git.run(["rev-parse", "HEAD"])).stdout.trim();
          }
        }

        // Step 4: Push commit if made
        let pushed: boolean | null = null;
        if (commitSha !== null && this.hasRemote) {
          let pushSuccess = false;
          for (let attempt = 0; attempt < 3; attempt++) {
            const pushRes = await this.git.run(["push", "origin", `HEAD:refs/heads/${this.config.gitBranch}`], {
              allowFail: true,
            });

            if (pushRes.code === 0) {
              pushSuccess = true;
              pushed = true;
              break;
            }

            if (isPushRejection(pushRes.stderr)) {
              const pre = (await this.git.run(["rev-parse", "HEAD"])).stdout.trim();
              await this.git.run(["fetch", "origin", this.config.gitBranch], { allowFail: true });
              const rebaseRes = await this.git.run(["rebase", `origin/${this.config.gitBranch}`], { allowFail: true });

              if (rebaseRes.code === 0) {
                const post = (await this.git.run(["rev-parse", "HEAD"])).stdout.trim();
                const diffRes = await this.git.run(["diff", "--name-only", pre, post]);
                await this.resync(extractChangedProjects(diffRes.stdout));
              } else {
                await this.git.run(["rebase", "--abort"], { allowFail: true });
                await this.git.run(["reset", "--hard", `origin/${this.config.gitBranch}`]);
                await this.resync(spec.projects);
                throw new OkfError(
                  "upstream_conflict",
                  409,
                  "change conflicts with a concurrent upstream edit; re-read and retry",
                );
              }
            } else {
              pushed = false;
              const firstLine = pushRes.stderr.split(/\r?\n/)[0] ?? "unknown error";
              warnings.push(`push failed; will retry on next sync: ${firstLine}`);
              break;
            }
          }

          if (!pushSuccess && pushed === null) {
            pushed = false;
          }
        }

        return {
          value: workRes.value,
          commit: commitSha,
          pushed,
          warnings,
        };
      } catch (err) {
        await this.git.run(["reset", "--hard", "HEAD"], { allowFail: true });
        const cleanArgs = spec.projects.length > 0 ? ["clean", "-fd", "--", ...spec.projects] : ["clean", "-fd"];
        await this.git.run(cleanArgs, { allowFail: true });
        await this.resync(spec.projects);
        throw err;
      }
    });
  }

  async sync(): Promise<SyncStatus> {
    return this.mutex.run(async () => {
      if (!this.hasRemote) {
        return this.syncStatus();
      }

      const before = (await this.git.run(["rev-parse", "HEAD"])).stdout.trim();
      const fetchRes = await this.git.run(["fetch", "origin", this.config.gitBranch], { allowFail: true });

      if (fetchRes.code !== 0) {
        this.lastError = fetchRes.stderr.split(/\r?\n/)[0] ?? "fetch failed";
        return this.syncStatus();
      }

      const behindRes = await this.git.run(["rev-list", "--count", `HEAD..origin/${this.config.gitBranch}`], {
        allowFail: true,
      });
      const behind = Number.parseInt(behindRes.stdout.trim(), 10) || 0;

      let runError: string | null = null;
      if (behind > 0) {
        const rebaseRes = await this.git.run(["rebase", `origin/${this.config.gitBranch}`], { allowFail: true });

        if (rebaseRes.code !== 0) {
          runError = `rebase conflict; ${await this.preserveConflict()}`;
        }
        const after = (await this.git.run(["rev-parse", "HEAD"])).stdout.trim();
        if (before !== after) {
          const diffRes = await this.git.run(["diff", "--name-only", before, after]);
          await this.resync(extractChangedProjects(diffRes.stdout));
        }
      }

      const aheadRes = await this.git.run(["rev-list", "--count", `origin/${this.config.gitBranch}..HEAD`], {
        allowFail: true,
      });
      const ahead = Number.parseInt(aheadRes.stdout.trim(), 10) || 0;

      if (ahead > 0) {
        const pushRes = await this.git.run(["push", "origin", `HEAD:refs/heads/${this.config.gitBranch}`], {
          allowFail: true,
        });
        if (pushRes.code !== 0) {
          const pushError = `push failed: ${pushRes.stderr.split(/\r?\n/)[0] ?? "unknown error"}`;
          runError = runError ? `${runError}; ${pushError}` : pushError;
        }
      }

      // lastError describes the most recent sync run only.
      this.lastError = runError;

      this.lastSyncAt = nowIso();
      return this.syncStatus();
    });
  }

  async syncStatus(): Promise<SyncStatus> {
    const remote = this.config.gitRemoteUrl ? redactRemote(this.config.gitRemoteUrl) : null;
    let ahead = 0;
    let behind = 0;

    if (this.hasRemote) {
      const aheadRes = await this.git.run(["rev-list", "--count", `origin/${this.config.gitBranch}..HEAD`], {
        allowFail: true,
      });
      if (aheadRes.code === 0) {
        ahead = Number.parseInt(aheadRes.stdout.trim(), 10) || 0;
      }
      const behindRes = await this.git.run(["rev-list", "--count", `HEAD..origin/${this.config.gitBranch}`], {
        allowFail: true,
      });
      if (behindRes.code === 0) {
        behind = Number.parseInt(behindRes.stdout.trim(), 10) || 0;
      }
    }

    return {
      remote,
      branch: this.config.gitBranch,
      lastSyncAt: this.lastSyncAt,
      lastError: this.lastError,
      ahead,
      behind,
    };
  }

  async history(project: string, path: string | null, limit: number): Promise<HistoryEntry[]> {
    const clampedLimit = Math.max(1, Math.min(100, limit));
    const args = [
      "log",
      "-n",
      String(clampedLimit),
      "--format=%H%x1f%aI%x1f%an%x1f%s%x1f%(trailers:key=Okf-Principal,valueonly)%x1e",
    ];
    args.push("--", path === null ? `${project}/` : `${project}/${path}`);

    const res = await this.git.run(args, { allowFail: true });
    if (res.code !== 0) {
      return [];
    }

    const entries = res.stdout.split("\x1e").filter((e) => e.trim().length > 0);
    const commits: HistoryEntry[] = [];

    for (const entry of entries) {
      const parts = entry.trim().split("\x1f");
      const sha = parts[0] ?? "";
      const at = parts[1] ?? "";
      const actor = parts[2] ?? "";
      const subject = parts[3] ?? "";
      const principalRaw = parts[4]?.trim();
      commits.push({
        sha,
        at,
        actor,
        subject,
        principal: principalRaw && principalRaw.length > 0 ? principalRaw : null,
      });
    }

    return commits;
  }

  archive(project: string): Readable {
    return this.git.spawnStdout(["archive", "--format=tar.gz", "HEAD", "--", project]);
  }
}
