import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Readable } from "node:stream";
import type { Config, Logger } from "../config.js";
import { OkfError } from "../errors.js";
import { nowIso } from "../okf/frontmatter.js";
import { PROJECT_RE } from "../okf/paths.js";
import { Git, isPushRejection, redactRemote } from "./git.js";
import { Mutex } from "./mutex.js";
import { pathExists } from "./fs-util.js";

export interface SyncStatus {
  remote: string | null;
  branch: string;
  lastSyncAt: string | null;
  lastError: string | null;
  ahead: number;
  behind: number;
}

function extractChangedProjects(diffOutput: string): string[] {
  const lines = diffOutput.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  const projects = new Set<string>();
  for (const line of lines) {
    const firstSegment = line.split("/")[0];
    if (firstSegment && PROJECT_RE.test(firstSegment)) {
      projects.add(firstSegment);
    }
  }
  return Array.from(projects);
}

export class Repo {
  readonly config: Config;
  readonly log: Logger;
  readonly repoDir: string;
  readonly homeDir: string;
  readonly tmpDir: string;
  readonly git: Git;
  readonly mutex: Mutex;

  private treeChangedHandler: ((projects: string[]) => Promise<void>) | null = null;
  private lastSyncAt: string | null = null;
  private lastError: string | null = null;

  constructor(config: Config, log: Logger, repoDir: string, homeDir: string, tmpDir: string) {
    this.config = config;
    this.log = log;
    this.repoDir = repoDir;
    this.homeDir = homeDir;
    this.tmpDir = tmpDir;
    this.git = new Git(repoDir, homeDir, config);
    this.mutex = new Mutex();
  }

  get hasRemote(): boolean {
    return Boolean(this.config.gitRemoteUrl && this.config.gitRemoteUrl.trim().length > 0);
  }

  setTreeChangedHandler(fn: (projects: string[]) => Promise<void>): void {
    this.treeChangedHandler = fn;
  }

  async idle(): Promise<void> {
    await this.mutex.idle();
  }

  static async open(config: Config, log: Logger): Promise<Repo> {
    const repoDir = join(config.dataDir, "repo");
    const homeDir = join(config.dataDir, "home");
    const tmpDir = join(config.dataDir, "tmp");

    await mkdir(repoDir, { recursive: true });
    await mkdir(homeDir, { recursive: true });
    await mkdir(tmpDir, { recursive: true });

    // Empty tmp directory
    try {
      const tmpEntries = await readdir(tmpDir);
      for (const entry of tmpEntries) {
        await rm(join(tmpDir, entry), { recursive: true, force: true });
      }
    } catch {
      // ignore
    }

    const repo = new Repo(config, log, repoDir, homeDir, tmpDir);
    await repo.git.prepareSsh();

    // Check if git initialized
    const gitDirExists = await pathExists(join(repoDir, ".git"));
    if (!gitDirExists) {
      await repo.git.run(["init", "-b", config.gitBranch]);
    }

    const headRev = await repo.git.run(["rev-parse", "--verify", "HEAD"], { allowFail: true });
    let headHasCommits = headRev.code === 0;

    if (repo.hasRemote) {
      const remotes = await repo.git.run(["remote"], { allowFail: true });
      const remoteList = remotes.stdout.split(/\r?\n/).map((r) => r.trim());
      if (remoteList.includes("origin")) {
        await repo.git.run(["remote", "set-url", "origin", config.gitRemoteUrl!]);
      } else {
        await repo.git.run(["remote", "add", "origin", config.gitRemoteUrl!]);
      }

      const fetchRes = await repo.git.run(["fetch", "origin", config.gitBranch], { allowFail: true });
      if (fetchRes.code !== 0) {
        const isRefNotFound = fetchRes.stderr.includes("couldn't find remote ref");
        if (!isRefNotFound) {
          if (!headHasCommits) {
            throw new Error(
              `Failed to fetch from remote on empty local repository:\n${fetchRes.stderr}`
            );
          } else {
            log.warn({ stderr: fetchRes.stderr }, "Fetch failed on startup; continuing with local commits");
          }
        }
      }

      const remoteBranchRev = await repo.git.run(
        ["rev-parse", "--verify", `origin/${config.gitBranch}`],
        { allowFail: true }
      );
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

    const requiredAttrLines = [
      "**/index.md merge=union",
      "**/log.md merge=union",
    ];

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

  async commitInternal(
    subject: string,
    author: string,
    principal: { subject: string; clientId: string },
    projects: string[]
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
      { allowFail: true }
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
    work: () => Promise<{
      value: T;
      commit: {
        subject: string;
        body?: string;
        author: string;
        principal: { subject: string; clientId: string };
      } | null;
    }>
  ): Promise<{ value: T; commit: string | null; pushed: boolean | null; warnings: string[] }> {
    return this.mutex.run(async () => {
      const warnings: string[] = [];

      // Step 1: Remote sync check before work
      if (this.hasRemote) {
        const fetchRes = await this.git.run(
          ["fetch", "origin", this.config.gitBranch],
          { allowFail: true }
        );

        if (fetchRes.code !== 0) {
          const firstLine = fetchRes.stderr.split(/\r?\n/)[0] ?? "unknown error";
          warnings.push(`remote unreachable: ${firstLine}`);
        } else {
          const behindRes = await this.git.run(
            ["rev-list", "--count", `HEAD..origin/${this.config.gitBranch}`],
            { allowFail: true }
          );
          const behind = Number.parseInt(behindRes.stdout.trim(), 10) || 0;

          if (behind > 0) {
            const before = (await this.git.run(["rev-parse", "HEAD"])).stdout.trim();
            const rebaseRes = await this.git.run(
              ["rebase", `origin/${this.config.gitBranch}`],
              { allowFail: true }
            );

            if (rebaseRes.code !== 0) {
              warnings.push(await this.preserveConflict());
            }
            const after = (await this.git.run(["rev-parse", "HEAD"])).stdout.trim();
            if (before !== after) {
              const diffRes = await this.git.run(["diff", "--name-only", before, after]);
              const changed = extractChangedProjects(diffRes.stdout);
              if (this.treeChangedHandler && changed.length > 0) {
                await this.treeChangedHandler(changed);
              }
            }
          }
        }
      }

      // Step 2 & 3: Run work and commit
      try {
        const workRes = await work();

        let commitSha: string | null = null;
        if (workRes.commit) {
          const addArgs =
            spec.projects.length > 0
              ? ["add", "-A", "--", ...spec.projects]
              : ["add", "-A"];
          await this.git.run(addArgs);

          const diffCheck = await this.git.run(["diff", "--cached", "--quiet"], { allowFail: true });
          if (diffCheck.code !== 0) {
            const c = workRes.commit;
            const commitArgs = [
              "commit",
              `--author=${c.author} <ok-fine@localhost>`,
              "-m",
              c.subject,
            ];
            if (c.body && c.body.trim().length > 0) {
              commitArgs.push("-m", c.body);
            }
            commitArgs.push(
              "-m",
              `Okf-Principal: sub=${c.principal.subject} client=${c.principal.clientId}`
            );
            await this.git.run(commitArgs);
            commitSha = (await this.git.run(["rev-parse", "HEAD"])).stdout.trim();
          }
        }

        // Step 4: Push commit if made
        let pushed: boolean | null = null;
        if (commitSha !== null && this.hasRemote) {
          let pushSuccess = false;
          for (let attempt = 0; attempt < 3; attempt++) {
            const pushRes = await this.git.run(
              ["push", "origin", `HEAD:refs/heads/${this.config.gitBranch}`],
              { allowFail: true }
            );

            if (pushRes.code === 0) {
              pushSuccess = true;
              pushed = true;
              break;
            }

            if (isPushRejection(pushRes.stderr)) {
              const pre = (await this.git.run(["rev-parse", "HEAD"])).stdout.trim();
              await this.git.run(["fetch", "origin", this.config.gitBranch], { allowFail: true });
              const rebaseRes = await this.git.run(
                ["rebase", `origin/${this.config.gitBranch}`],
                { allowFail: true }
              );

              if (rebaseRes.code === 0) {
                const post = (await this.git.run(["rev-parse", "HEAD"])).stdout.trim();
                const diffRes = await this.git.run(["diff", "--name-only", pre, post]);
                const changed = extractChangedProjects(diffRes.stdout);
                if (this.treeChangedHandler && changed.length > 0) {
                  await this.treeChangedHandler(changed);
                }
                continue; // retry push
              } else {
                await this.git.run(["rebase", "--abort"], { allowFail: true });
                await this.git.run(["reset", "--hard", `origin/${this.config.gitBranch}`]);
                if (this.treeChangedHandler && spec.projects.length > 0) {
                  await this.treeChangedHandler(spec.projects);
                }
                throw new OkfError(
                  "upstream_conflict",
                  409,
                  "change conflicts with a concurrent upstream edit; re-read and retry"
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
        const cleanArgs =
          spec.projects.length > 0 ? ["clean", "-fd", "--", ...spec.projects] : ["clean", "-fd"];
        await this.git.run(cleanArgs, { allowFail: true });
        if (this.treeChangedHandler && spec.projects.length > 0) {
          await this.treeChangedHandler(spec.projects);
        }
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
      const fetchRes = await this.git.run(
        ["fetch", "origin", this.config.gitBranch],
        { allowFail: true }
      );

      if (fetchRes.code !== 0) {
        this.lastError = fetchRes.stderr.split(/\r?\n/)[0] ?? "fetch failed";
        return this.syncStatus();
      }

      const behindRes = await this.git.run(
        ["rev-list", "--count", `HEAD..origin/${this.config.gitBranch}`],
        { allowFail: true }
      );
      const behind = Number.parseInt(behindRes.stdout.trim(), 10) || 0;

      let runError: string | null = null;
      if (behind > 0) {
        const rebaseRes = await this.git.run(
          ["rebase", `origin/${this.config.gitBranch}`],
          { allowFail: true }
        );

        if (rebaseRes.code !== 0) {
          runError = `rebase conflict; ${await this.preserveConflict()}`;
        }
        const after = (await this.git.run(["rev-parse", "HEAD"])).stdout.trim();
        if (before !== after) {
          const diffRes = await this.git.run(["diff", "--name-only", before, after]);
          const changed = extractChangedProjects(diffRes.stdout);
          if (this.treeChangedHandler && changed.length > 0) {
            await this.treeChangedHandler(changed);
          }
        }
      }

      const aheadRes = await this.git.run(
        ["rev-list", "--count", `origin/${this.config.gitBranch}..HEAD`],
        { allowFail: true }
      );
      const ahead = Number.parseInt(aheadRes.stdout.trim(), 10) || 0;

      if (ahead > 0) {
        const pushRes = await this.git.run(
          ["push", "origin", `HEAD:refs/heads/${this.config.gitBranch}`],
          { allowFail: true }
        );
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
      const aheadRes = await this.git.run(
        ["rev-list", "--count", `origin/${this.config.gitBranch}..HEAD`],
        { allowFail: true }
      );
      if (aheadRes.code === 0) {
        ahead = Number.parseInt(aheadRes.stdout.trim(), 10) || 0;
      }
      const behindRes = await this.git.run(
        ["rev-list", "--count", `HEAD..origin/${this.config.gitBranch}`],
        { allowFail: true }
      );
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

  async history(
    path?: string,
    limit = 20
  ): Promise<Array<{ sha: string; at: string; actor: string; subject: string; principal: string | null }>> {
    const clampedLimit = Math.max(1, Math.min(100, limit));
    const args = [
      "log",
      "-n",
      String(clampedLimit),
      "--format=%H%x1f%aI%x1f%an%x1f%s%x1f%(trailers:key=Okf-Principal,valueonly)%x1e",
    ];
    if (path) {
      args.push("--", path);
    }

    const res = await this.git.run(args, { allowFail: true });
    if (res.code !== 0) {
      return [];
    }

    const entries = res.stdout.split("\x1e").filter((e) => e.trim().length > 0);
    const commits: Array<{
      sha: string;
      at: string;
      actor: string;
      subject: string;
      principal: string | null;
    }> = [];

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

  archiveStream(project: string): Readable {
    return this.git.spawnStdout(["archive", "--format=tar.gz", "HEAD", "--", project]);
  }
}
