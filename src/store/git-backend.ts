import { lstat, mkdir, readdir, readFile, rm, rmdir } from "node:fs/promises";
import { join, posix } from "node:path";
import type { Readable } from "node:stream";
import type { Logger, StorageConfig } from "../config.js";
import { OkfError } from "../errors.js";
import { nowIso } from "../okf/frontmatter.js";
import { PROJECT_RE } from "../okf/paths.js";
import { parseActor } from "../okf/semantics.js";
import type {
  BundleSource,
  CommitSpec,
  Conflict,
  ConflictFile,
  ConflictSide,
  HistoryEntry,
  ResyncHandler,
  StorageBackend,
  StorageTx,
  SyncStatus,
  TransactionResult,
} from "./backend.js";
import type { BundleTree } from "./bundle.js";
import { assertContainedPath, atomicWrite, listTreeFiles, pathExists } from "./fs-util.js";
import { Git, isPushRejection, redactRemote } from "./git.js";
import { Mutex } from "./mutex.js";
import { PathIndex } from "./path-index.js";

const REMOTE_BASE_REF = "refs/ok-fine/remote-base";
const REMOTE_REWRITTEN_MSG =
  "remote history was rewritten; syncing halted. Stop ok-fine, remove DATA_DIR/repo, and restart to re-clone";

// One ref per (project, conflict): refs/heads/ok-fine/conflict/<project>/<id>. The commit stays reachable while
// any project's ref remains, so resolving one project never drops another project's preserved writes.
const CONFLICT_REF_PREFIX = "refs/heads/ok-fine/conflict/";
// Pre-split format: one branch for all projects. Migrated to per-project refs on open.
const LEGACY_CONFLICT_REF_PREFIX = "refs/heads/ok-fine/conflict-";
// Resolved conflicts whose remote branch still has to be deleted.
const RESOLVED_REF_PREFIX = "refs/ok-fine/resolved/";
// Holds preserved commits that touch no project directory, so they stay reachable.
const REPOSITORY_CONFLICT_SCOPE = "_repository";
/** `<UTC stamp>-<12 hex of the preserved tip>`; legacy stamps have no milliseconds. */
const CONFLICT_ID_RE = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\.\d{3})?Z-[0-9a-f]{12}$/;
const HISTORY_FORMAT = "--format=%H%x1f%aI%x1f%an%x1f%s%x1f%(trailers:key=Okf-Principal,valueonly)%x1e";

function conflictRef(project: string, id: string): string {
  return `${CONFLICT_REF_PREFIX}${project}/${id}`;
}

function conflictDetectedAt(id: string): string {
  const m = CONFLICT_ID_RE.exec(id);
  if (!m) return "";
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7] ?? ""}Z`;
}

/** Server-generated files: rebuilt after every sync, so a conflict on them never needs a client merge. */
function isGeneratedPath(path: string): boolean {
  return path === "log.md" || path === "index.md" || path.endsWith("/index.md");
}

function parseHistory(stdout: string): HistoryEntry[] {
  const commits: HistoryEntry[] = [];
  for (const entry of stdout.split("\x1e")) {
    if (entry.trim().length === 0) continue;
    const parts = entry.trim().split("\x1f");
    const principalRaw = parts[4]?.trim();
    commits.push({
      sha: parts[0] ?? "",
      at: parts[1] ?? "",
      actor: parts[2] ?? "",
      subject: parts[3] ?? "",
      principal: principalRaw && principalRaw.length > 0 ? principalRaw : null,
    });
  }
  return commits;
}

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
  /** Applied by GitBackend.transaction only after the transaction succeeds. */
  readonly resolutions: Array<{ project: string; id: string }> = [];

  constructor(
    private readonly repoDir: string,
    private readonly index: PathIndex,
  ) {}

  async writeFile(project: string, path: string, content: string | Buffer): Promise<void> {
    await assertContainedPath(this.repoDir, project, path);
    await atomicWrite(join(this.repoDir, project, path), content);
    this.index.add(project, path);
    this.touched = true;
  }

  async deleteFile(project: string, path: string): Promise<void> {
    await assertContainedPath(this.repoDir, project, path);
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
    const projectDir = join(this.repoDir, project);
    try {
      const s = await lstat(projectDir);
      if (s.isSymbolicLink()) {
        await rm(projectDir, { force: true });
      } else {
        await rm(projectDir, { recursive: true, force: true });
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw err;
      }
    }
    this.index.setProject(project, []);
    this.touched = true;
  }

  async replaceProject(project: string, source: BundleSource): Promise<void> {
    const projectDir = join(this.repoDir, project);
    try {
      const s = await lstat(projectDir);
      if (s.isSymbolicLink()) {
        await rm(projectDir, { force: true });
      } else {
        await rm(projectDir, { recursive: true, force: true });
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw err;
      }
    }
    const written: string[] = [];
    for (const path of source.paths) {
      await assertContainedPath(this.repoDir, project, path);
      const content = await source.read(path);
      if (content !== null) {
        await atomicWrite(join(projectDir, path), content);
        written.push(path);
      }
    }
    this.index.setProject(project, written);
    this.touched = true;
  }

  async resolveConflict(project: string, id: string): Promise<void> {
    if (!this.resolutions.some((r) => r.project === project && r.id === id)) {
      this.resolutions.push({ project, id });
    }
  }
}

export class GitBackend implements StorageBackend {
  readonly config: StorageConfig;
  readonly log: Logger;
  readonly repoDir: string;
  readonly homeDir: string;
  readonly git: Git;
  private readonly mutex = new Mutex();
  private readonly index = new PathIndex();

  private resyncHandler: ResyncHandler | null = null;
  private lastSyncAt: string | null = null;
  private lastError: string | null = null;
  /** project -> conflict id -> preserved tip. Only this class creates or deletes conflict refs. */
  private readonly conflictRefs = new Map<string, Map<string, string>>();

  constructor(config: StorageConfig, log: Logger, repoDir: string, homeDir: string) {
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
    await this.git.close();
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
      await assertContainedPath(this.repoDir, project, path);
      const fullPath = join(this.repoDir, project, path);
      const s = await lstat(fullPath);
      if (s.isSymbolicLink() || !s.isFile()) {
        return null;
      }
      return await readFile(fullPath);
    } catch {
      return null;
    }
  }

  private async reindexProject(project: string): Promise<void> {
    const dir = join(this.repoDir, project);
    let paths: string[] = [];
    try {
      const s = await lstat(dir);
      if (!s.isSymbolicLink() && s.isDirectory()) {
        paths = await listTreeFiles(dir);
      }
    } catch {
      paths = [];
    }
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

  static async open(config: StorageConfig, log: Logger): Promise<GitBackend> {
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
          await repo.setRememberedRemoteTip(remoteBranchRev.stdout.trim());
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
          const initialHead = (await repo.git.run(["rev-parse", "HEAD"])).stdout.trim();
          await repo.setRememberedRemoteTip(initialHead);
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
          const pushRes = await repo.git.run(["push", "origin", `HEAD:refs/heads/${config.gitBranch}`], {
            allowFail: true,
          });
          if (pushRes.code === 0) {
            const headSha = (await repo.git.run(["rev-parse", "HEAD"])).stdout.trim();
            await repo.setRememberedRemoteTip(headSha);
          }
        }
      }
    }

    await repo.migrateLegacyConflicts();
    await repo.loadConflictRefs();
    await repo.reindexAll();
    return repo;
  }

  private async getRememberedRemoteTip(): Promise<string | null> {
    const res = await this.git.run(["rev-parse", "--verify", REMOTE_BASE_REF], {
      allowFail: true,
    });
    if (res.code === 0 && res.stdout.trim().length > 0) {
      return res.stdout.trim();
    }
    return null;
  }

  private async setRememberedRemoteTip(sha: string): Promise<void> {
    await this.git.run(["update-ref", REMOTE_BASE_REF, sha], { allowFail: true });
  }

  private async isRemoteAncestorHalted(remoteTip: string): Promise<boolean> {
    const rememberedTip = await this.getRememberedRemoteTip();
    if (!rememberedTip) {
      await this.setRememberedRemoteTip(remoteTip);
      return false;
    }
    if (rememberedTip === remoteTip) {
      return false;
    }
    const ancestorCheck = await this.git.run(["merge-base", "--is-ancestor", rememberedTip, remoteTip], {
      allowFail: true,
    });
    if (ancestorCheck.code !== 0) {
      this.lastError = REMOTE_REWRITTEN_MSG;
      this.log.error({ rememberedTip, remoteTip }, REMOTE_REWRITTEN_MSG);
      return true;
    }
    return false;
  }

  private async ensureAttributesAndIgnore(): Promise<boolean> {
    let changed = false;

    const gitattributesPath = join(this.repoDir, ".gitattributes");
    let attrContent = "";
    try {
      const s = await lstat(gitattributesPath);
      if (s.isSymbolicLink()) {
        await rm(gitattributesPath, { force: true });
      } else {
        attrContent = await readFile(gitattributesPath, "utf8");
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw err;
      }
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
      await atomicWrite(gitattributesPath, newAttrContent);
      await this.git.run(["add", ".gitattributes"]);
      changed = true;
    }

    const gitignorePath = join(this.repoDir, ".gitignore");
    let ignoreContent = "";
    try {
      const s = await lstat(gitignorePath);
      if (s.isSymbolicLink()) {
        await rm(gitignorePath, { force: true });
      } else {
        ignoreContent = await readFile(gitignorePath, "utf8");
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw err;
      }
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
      await atomicWrite(gitignorePath, newIgnoreContent);
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

  private async mergeBase(a: string, b: string): Promise<string | null> {
    const res = await this.git.run(["merge-base", a, b], { allowFail: true });
    return res.code === 0 ? res.stdout.trim() : null;
  }

  /** Projects whose directories `tip` changed since its merge-base with `against`. */
  private async projectsChangedSince(tip: string, against: string): Promise<string[]> {
    const base = await this.mergeBase(tip, against);
    const res = base
      ? await this.git.run(["diff", "--name-only", "--no-renames", "-z", base, tip])
      : await this.git.run(["ls-tree", "-r", "--name-only", "-z", tip]);
    const projects = new Set<string>();
    for (const path of res.stdout.split("\0")) {
      const slash = path.indexOf("/");
      if (slash > 0 && PROJECT_RE.test(path.slice(0, slash))) projects.add(path.slice(0, slash));
    }
    return [...projects].sort();
  }

  /**
   * Aborts a failed rebase and keeps HEAD as one conflict per touched project (local refs, plus remote branches
   * when the push succeeds), then resets to the remote branch. Never overwrites an existing conflict.
   */
  private async preserveConflict(): Promise<{ message: string; conflicts: Array<{ project: string; id: string }> }> {
    await this.git.run(["rebase", "--abort"], { allowFail: true });
    const upstream = `origin/${this.config.gitBranch}`;
    const tip = (await this.git.run(["rev-parse", "HEAD"])).stdout.trim();
    const projects = await this.projectsChangedSince(tip, upstream);
    if (projects.length === 0) projects.push(REPOSITORY_CONFLICT_SCOPE);

    // Millisecond stamp plus tip prefix; update-ref with an empty old value fails rather than overwrite.
    const id = `${new Date().toISOString().replace(/[-:]/g, "")}-${tip.slice(0, 12)}`;
    const conflicts = projects.map((project) => ({ project, id }));
    for (const { project } of conflicts) {
      await this.git.run(["update-ref", conflictRef(project, id), tip, ""]);
      let byId = this.conflictRefs.get(project);
      if (!byId) {
        byId = new Map();
        this.conflictRefs.set(project, byId);
      }
      byId.set(id, tip);
    }
    const pushRes = await this.git.run(
      ["push", "origin", ...conflicts.map(({ project }) => `${conflictRef(project, id)}:${conflictRef(project, id)}`)],
      { allowFail: true },
    );
    await this.git.run(["reset", "--hard", upstream]);

    let message = `local commits preserved as conflict ${id} in ${projects.join(", ")}`;
    if (pushRes.code !== 0) {
      const reason = pushRes.stderr.trim().split("\n")[0] ?? "";
      message += ` (kept locally only; pushing the conflict branches failed: ${reason})`;
    }
    this.log.error({ stderr: pushRes.code !== 0 ? pushRes.stderr : undefined }, `rebase conflict; ${message}`);
    return { message, conflicts };
  }

  /** Splits single-branch `ok-fine/conflict-<stamp>` conflicts into per-project refs. Remote copies are kept. */
  private async migrateLegacyConflicts(): Promise<void> {
    const res = await this.git.run([
      "for-each-ref",
      "--format=%(objectname) %(refname)",
      `${LEGACY_CONFLICT_REF_PREFIX}*`,
    ]);
    for (const line of res.stdout.split("\n")) {
      const [tip, ref] = line.split(" ");
      if (!tip || !ref) continue;
      const id = `${ref.slice(LEGACY_CONFLICT_REF_PREFIX.length)}-${tip.slice(0, 12)}`;
      if (!CONFLICT_ID_RE.test(id)) {
        this.log.warn({ ref }, "leaving unrecognized legacy conflict branch in place");
        continue;
      }
      const projects = await this.projectsChangedSince(tip, "HEAD");
      if (projects.length === 0) projects.push(REPOSITORY_CONFLICT_SCOPE);
      for (const project of projects) {
        const target = conflictRef(project, id);
        const exists = await this.git.run(["rev-parse", "--verify", "--quiet", target], { allowFail: true });
        if (exists.code !== 0) await this.git.run(["update-ref", target, tip, ""]);
      }
      await this.git.run(["update-ref", "-d", ref, tip]);
    }
  }

  private async loadConflictRefs(): Promise<void> {
    this.conflictRefs.clear();
    const res = await this.git.run(["for-each-ref", "--format=%(objectname) %(refname)", CONFLICT_REF_PREFIX]);
    for (const line of res.stdout.split("\n")) {
      const [tip, ref] = line.split(" ");
      if (!tip || !ref) continue;
      const [project, id, ...rest] = ref.slice(CONFLICT_REF_PREFIX.length).split("/");
      if (!project || !id || rest.length > 0 || !CONFLICT_ID_RE.test(id)) continue;
      let byId = this.conflictRefs.get(project);
      if (!byId) {
        byId = new Map();
        this.conflictRefs.set(project, byId);
      }
      byId.set(id, tip);
    }
  }

  /** Drops resolved conflicts locally; with a remote, keeps a marker until the remote branch is deleted too. */
  private async applyResolutions(resolutions: Array<{ project: string; id: string }>): Promise<void> {
    for (const { project, id } of resolutions) {
      const byId = this.conflictRefs.get(project);
      const tip = byId?.get(id);
      if (!byId || !tip) continue;
      if (this.hasRemote) await this.git.run(["update-ref", `${RESOLVED_REF_PREFIX}${project}/${id}`, tip]);
      await this.git.run(["update-ref", "-d", conflictRef(project, id), tip]);
      byId.delete(id);
    }
  }

  /** Deletes remote branches of resolved conflicts; returns one message per deletion still pending. */
  private async pushResolutions(): Promise<string[]> {
    const res = await this.git.run(["for-each-ref", "--format=%(refname)", RESOLVED_REF_PREFIX]);
    const pending: string[] = [];
    for (const marker of res.stdout.split("\n")) {
      if (!marker) continue;
      const name = marker.slice(RESOLVED_REF_PREFIX.length);
      const del = await this.git.run(["push", "origin", `:${CONFLICT_REF_PREFIX}${name}`], { allowFail: true });
      // Never pushed (the preserving push failed) counts as deleted.
      if (del.code === 0 || del.stderr.includes("remote ref does not exist")) {
        await this.git.run(["update-ref", "-d", marker]);
      } else {
        const reason = del.stderr.trim().split("\n")[0] ?? "";
        pending.push(
          `conflict ${name} resolved; deleting its remote branch failed, will retry on next sync: ${reason}`,
        );
      }
    }
    return pending;
  }

  async conflicts(project: string): Promise<Conflict[]> {
    const byId = this.conflictRefs.get(project);
    if (!byId || byId.size === 0) return [];
    const scope = `${project}/`;
    const out: Conflict[] = [];
    for (const id of [...byId.keys()].sort()) {
      const tip = byId.get(id);
      if (!tip) continue;
      const base = await this.mergeBase(tip, "HEAD");
      const files: ConflictFile[] = [];
      if (base) {
        const current = await this.git.run(["diff", "--name-only", "--no-renames", "-z", base, "HEAD", "--", scope]);
        const changedHere = new Set(current.stdout.split("\0"));
        const preserved = await this.git.run(["diff", "--name-status", "--no-renames", "-z", base, tip, "--", scope]);
        // -z name-status output alternates status and path.
        const fields = preserved.stdout.split("\0");
        for (let i = 0; i + 1 < fields.length; i += 2) {
          const status = fields[i] ?? "";
          const full = fields[i + 1] ?? "";
          const path = full.slice(scope.length);
          if (isGeneratedPath(path)) continue;
          const change = status === "A" ? "added" : status === "D" ? "deleted" : "modified";
          files.push({ path, change, divergent: changedHere.has(full) });
        }
      } else {
        const listed = await this.git.run(["ls-tree", "-r", "--name-only", "-z", tip, "--", scope]);
        for (const full of listed.stdout.split("\0")) {
          const path = full.slice(scope.length);
          if (full.length === 0 || isGeneratedPath(path)) continue;
          files.push({ path, change: "added", divergent: true });
        }
      }
      const log = await this.git.run(["log", "-n", "20", HISTORY_FORMAT, base ? `${base}..${tip}` : tip, "--", scope]);
      const writes = parseHistory(log.stdout).map(({ at, actor, subject }) => ({ at, actor, subject }));
      out.push({ id, detectedAt: conflictDetectedAt(id), files, writes });
    }
    return out;
  }

  async readConflictFile(project: string, id: string, side: ConflictSide, path: string): Promise<Buffer | null> {
    const tip = this.conflictRefs.get(project)?.get(id);
    if (!tip) return null;
    const rev = side === "preserved" ? tip : await this.mergeBase(tip, "HEAD");
    if (!rev) return null;
    const res = await this.git.run(["cat-file", "blob", `${rev}:${project}/${path}`], { allowFail: true });
    return res.code === 0 ? res.stdoutBytes : null;
  }

  async transaction<T>(
    spec: { projects: string[] },
    work: (tx: StorageTx) => Promise<{ value: T; commit: CommitSpec | null }>,
  ): Promise<TransactionResult<T>> {
    return this.mutex.run(async () => {
      const warnings: string[] = [];
      let syncHalted = false;

      // Step 1: Remote sync check before work
      if (this.hasRemote) {
        const fetchRes = await this.git.run(["fetch", "origin", this.config.gitBranch], { allowFail: true });

        if (fetchRes.code !== 0) {
          const firstLine = fetchRes.stderr.split(/\r?\n/)[0] ?? "unknown error";
          warnings.push(`remote unreachable: ${firstLine}`);
        } else {
          const remoteRevRes = await this.git.run(["rev-parse", "--verify", `origin/${this.config.gitBranch}`], {
            allowFail: true,
          });
          if (remoteRevRes.code === 0) {
            const remoteTip = remoteRevRes.stdout.trim();
            if (await this.isRemoteAncestorHalted(remoteTip)) {
              syncHalted = true;
              warnings.push(this.lastError ?? REMOTE_REWRITTEN_MSG);
            }
          }

          if (!syncHalted) {
            const behindRes = await this.git.run(["rev-list", "--count", `HEAD..origin/${this.config.gitBranch}`], {
              allowFail: true,
            });
            const behind = Number.parseInt(behindRes.stdout.trim(), 10) || 0;

            if (behind > 0) {
              const before = (await this.git.run(["rev-parse", "HEAD"])).stdout.trim();
              const rebaseRes = await this.git.run(["rebase", `origin/${this.config.gitBranch}`], { allowFail: true });

              if (rebaseRes.code !== 0) {
                warnings.push((await this.preserveConflict()).message);
              }
              const after = (await this.git.run(["rev-parse", "HEAD"])).stdout.trim();
              if (before !== after) {
                const diffRes = await this.git.run(["diff", "--name-only", before, after]);
                await this.resync(extractChangedProjects(diffRes.stdout));
              }
            }
          }
        }
      }

      // Step 2 & 3: Run work and commit
      try {
        const tx = new GitTx(this.repoDir, this.index);
        const workRes = await work(tx);

        let commitSha: string | null = null;
        if (workRes.commit) {
          const addArgs = spec.projects.length > 0 ? ["add", "-A", "--", ...spec.projects] : ["add", "-A"];
          await this.git.run(addArgs);

          const diffCheck = await this.git.run(["diff", "--cached", "--quiet"], { allowFail: true });
          if (diffCheck.code !== 0) {
            const c = workRes.commit;
            // human:<email> writes carry the person's own email so bundle history matches their code commits.
            const actor = parseActor(c.author);
            const authorEmail = actor?.kind === "human" && actor.id.includes("@") ? actor.id : "ok-fine@localhost";
            const commitArgs = ["commit", `--author=${c.author} <${authorEmail}>`, "-m", c.subject];
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
          if (syncHalted) {
            pushed = false;
          } else {
            let pushSuccess = false;
            for (let attempt = 0; attempt < 3; attempt++) {
              const pushRes = await this.git.run(["push", "origin", `HEAD:refs/heads/${this.config.gitBranch}`], {
                allowFail: true,
              });

              if (pushRes.code === 0) {
                pushSuccess = true;
                pushed = true;
                await this.setRememberedRemoteTip(commitSha);
                break;
              }

              if (isPushRejection(pushRes.stderr)) {
                const pre = (await this.git.run(["rev-parse", "HEAD"])).stdout.trim();
                await this.git.run(["fetch", "origin", this.config.gitBranch], { allowFail: true });

                const remoteRevRes = await this.git.run(["rev-parse", "--verify", `origin/${this.config.gitBranch}`], {
                  allowFail: true,
                });
                if (remoteRevRes.code === 0) {
                  const remoteTip = remoteRevRes.stdout.trim();
                  if (await this.isRemoteAncestorHalted(remoteTip)) {
                    pushed = false;
                    warnings.push(this.lastError ?? REMOTE_REWRITTEN_MSG);
                    break;
                  }
                }

                const rebaseRes = await this.git.run(["rebase", `origin/${this.config.gitBranch}`], {
                  allowFail: true,
                });

                if (rebaseRes.code === 0) {
                  const post = (await this.git.run(["rev-parse", "HEAD"])).stdout.trim();
                  const diffRes = await this.git.run(["diff", "--name-only", pre, post]);
                  await this.resync(extractChangedProjects(diffRes.stdout));
                } else {
                  // Keep every local commit, including this write and earlier unpushed ones.
                  const preserved = await this.preserveConflict();
                  const post = (await this.git.run(["rev-parse", "HEAD"])).stdout.trim();
                  const diffRes = await this.git.run(["diff", "--name-only", pre, post]);
                  await this.resync(extractChangedProjects(diffRes.stdout));
                  throw new OkfError(
                    "upstream_conflict",
                    409,
                    `change conflicts with a concurrent upstream edit; ${preserved.message}. Re-read, merge the preserved content, then resolve the conflict`,
                    { conflicts: preserved.conflicts },
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
        }

        if (tx.resolutions.length > 0) {
          await this.applyResolutions(tx.resolutions);
          if (this.hasRemote && !syncHalted) warnings.push(...(await this.pushResolutions()));
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
      const remoteRevRes = await this.git.run(["rev-parse", "--verify", `origin/${this.config.gitBranch}`], {
        allowFail: true,
      });
      if (remoteRevRes.code !== 0) {
        this.lastError = "remote ref not found";
        return this.syncStatus();
      }
      const remoteTip = remoteRevRes.stdout.trim();

      if (await this.isRemoteAncestorHalted(remoteTip)) {
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
          runError = `rebase conflict; ${(await this.preserveConflict()).message}`;
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
        } else {
          const headSha = (await this.git.run(["rev-parse", "HEAD"])).stdout.trim();
          await this.setRememberedRemoteTip(headSha);
        }
      } else {
        await this.setRememberedRemoteTip(remoteTip);
      }

      const pendingResolutions = await this.pushResolutions();
      if (pendingResolutions.length > 0) {
        const joined = pendingResolutions.join("; ");
        runError = runError ? `${runError}; ${joined}` : joined;
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
    const res = await this.git.run(
      ["log", "-n", String(clampedLimit), HISTORY_FORMAT, "--", path === null ? `${project}/` : `${project}/${path}`],
      { allowFail: true },
    );
    return res.code === 0 ? parseHistory(res.stdout) : [];
  }

  archive(project: string): Readable {
    return this.git.spawnStdout(["archive", "--format=tar.gz", "HEAD", "--", project]);
  }
}
