import { execFileSync, execSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Logger, loadConfig, loadStorageConfig } from "../config.js";
import { pathExists } from "./fs-util.js";
import { GitBackend } from "./git-backend.js";

const log: Logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
const commit = {
  subject: "test",
  author: "test/1.0",
  principal: { subject: "u1", clientId: "c1" },
};

describe("GitBackend", () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "okf-"));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  async function open(): Promise<{ storage: GitBackend }> {
    const config = loadConfig({
      DATA_DIR: dataDir,
      PUBLIC_BASE_URL: "https://okf.test",
      OAUTH_ISSUER: "https://auth.test",
      LOG_LEVEL: "silent",
    });
    return { storage: await GitBackend.open(config, log) };
  }

  it("rolls back a failed transaction on disk, in the index, and through the resync handler", async () => {
    const { storage } = await open();
    const resynced: string[] = [];
    storage.setResyncHandler(async (project) => {
      resynced.push(project);
    });

    await storage.transaction({ projects: ["p"] }, async (tx) => {
      await tx.writeFile("p", "a.md", "# A\n");
      return { value: null, commit };
    });

    await expect(
      storage.transaction({ projects: ["p"] }, async (tx) => {
        await tx.writeFile("p", "b.md", "# B\n");
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect((await storage.tree("p")).hasFile("b.md")).toBe(false);
    expect((await storage.tree("p")).hasFile("a.md")).toBe(true);
    expect(await pathExists(join(storage.repoDir, "p", "b.md"))).toBe(false);
    expect(resynced).toEqual(["p"]);
    expect(execSync("git status --porcelain", { cwd: storage.repoDir }).toString("utf8")).toBe("");
  });

  it("does not index or read symlinks", async () => {
    const first = await open();
    await first.storage.transaction({ projects: ["p"] }, async (tx) => {
      await tx.writeFile("p", "a.md", "# A\n");
      return { value: null, commit };
    });
    await first.storage.close();

    const outside = join(dataDir, "secret.txt");
    await writeFile(outside, "secret");
    await symlink(outside, join(first.storage.repoDir, "p", "link.md"));

    const { storage } = await open();
    expect((await storage.tree("p")).hasFile("link.md")).toBe(false);
    expect(await storage.readFile("p", "link.md")).toBeNull();
    expect((await storage.readFile("p", "a.md"))?.toString("utf8")).toBe("# A\n");
  });

  it("uses the host git config and credentials mapping when gitHostEnv is set", async () => {
    const bare = join(dataDir, "remote.git");
    execFileSync("git", ["init", "--bare", "-b", "main", bare]);
    const home = join(dataDir, "host-home");
    const hooks = join(home, "hooks");
    await mkdir(hooks, { recursive: true });
    await writeFile(join(hooks, "pre-commit"), "#!/bin/sh\nexit 1\n");
    await chmod(join(hooks, "pre-commit"), 0o755);
    await writeFile(
      join(home, ".gitconfig"),
      `[url "${bare}"]\n\tinsteadOf = https://okf.invalid/kb.git\n[core]\n\thooksPath = ${hooks}\n`,
    );

    const config = loadStorageConfig(
      {
        DATA_DIR: join(dataDir, "data"),
        GIT_REMOTE_URL: "https://okf.invalid/kb.git",
        LOG_LEVEL: "silent",
        HOME: home,
        PATH: process.env.PATH,
      },
      { inheritGitEnv: true },
    );
    const storage = await GitBackend.open(config, log);
    await storage.transaction({ projects: ["p"] }, async (tx) => {
      await tx.writeFile("p", "a.md", "# A\n");
      return { value: null, commit };
    });
    await storage.close();

    const subjects = execFileSync("git", ["--git-dir", bare, "log", "--format=%s", "main"]).toString("utf8");
    expect(subjects).toContain("test");
    expect(subjects).toContain("okf: initialize knowledge repository");
  });

  it("pushed root symlink to an outside dir with a file: projects() excludes it and readFile returns null", async () => {
    const bare = join(dataDir, "remote.git");
    execFileSync("git", ["init", "--bare", "-b", "main", bare]);

    const ext = join(dataDir, "ext");
    execFileSync("git", ["clone", bare, ext]);
    execFileSync("git", ["checkout", "-b", "main"], { cwd: ext });
    execFileSync("git", ["config", "user.name", "test"], { cwd: ext });
    execFileSync("git", ["config", "user.email", "test@test"], { cwd: ext });

    await mkdir(join(ext, "alpha"));
    await writeFile(join(ext, "alpha", "index.md"), "# Alpha\n");

    const outside = join(dataDir, "outside");
    await mkdir(outside);
    await writeFile(join(outside, "secret.txt"), "secret data");
    await writeFile(join(outside, "id_okf"), "secret key");

    await symlink(outside, join(ext, "leak"));
    execFileSync("git", ["add", "-A"], { cwd: ext });
    execFileSync("git", ["commit", "-m", "add alpha and leak symlink"], { cwd: ext });
    execFileSync("git", ["push", "origin", "main"], { cwd: ext });

    const config = loadStorageConfig({
      DATA_DIR: join(dataDir, "storage-data"),
      GIT_REMOTE_URL: bare,
      LOG_LEVEL: "silent",
    });
    const storage = await GitBackend.open(config, log);

    const projects = await storage.projects();
    expect(projects).toContain("alpha");
    expect(projects).not.toContain("leak");

    expect(await storage.readFile("leak", "id_okf")).toBeNull();
    expect(await storage.readFile("leak", "secret.txt")).toBeNull();
    expect(await pathExists(join(outside, "index.md"))).toBe(false);

    await storage.close();
  });

  it("pushed symlink alpha/g -> ../.git: tx write to g/x rejects and nothing appears in .git", async () => {
    const bare = join(dataDir, "remote.git");
    execFileSync("git", ["init", "--bare", "-b", "main", bare]);

    const ext = join(dataDir, "ext");
    execFileSync("git", ["clone", bare, ext]);
    execFileSync("git", ["checkout", "-b", "main"], { cwd: ext });
    execFileSync("git", ["config", "user.name", "test"], { cwd: ext });
    execFileSync("git", ["config", "user.email", "test@test"], { cwd: ext });

    await mkdir(join(ext, "alpha"));
    await writeFile(join(ext, "alpha", "index.md"), "# Alpha\n");
    await symlink("../.git", join(ext, "alpha", "g"));
    execFileSync("git", ["add", "-A"], { cwd: ext });
    execFileSync("git", ["commit", "-m", "add alpha with symlink g -> ../.git"], { cwd: ext });
    execFileSync("git", ["push", "origin", "main"], { cwd: ext });

    const config = loadStorageConfig({
      DATA_DIR: join(dataDir, "storage-data"),
      GIT_REMOTE_URL: bare,
      LOG_LEVEL: "silent",
    });
    const storage = await GitBackend.open(config, log);

    await expect(
      storage.transaction({ projects: ["alpha"] }, async (tx) => {
        await tx.writeFile("alpha", "g/x", "pwned\n");
        return { value: null, commit };
      }),
    ).rejects.toThrow();

    expect(await pathExists(join(storage.repoDir, ".git", "x"))).toBe(false);

    await storage.close();
  });

  it("remote force-pushed to unrelated history: sync halts, does not push local commits or conflict branches", async () => {
    const bare = join(dataDir, "remote.git");
    execFileSync("git", ["init", "--bare", "-b", "main", bare]);

    const ext = join(dataDir, "ext");
    execFileSync("git", ["clone", bare, ext]);
    execFileSync("git", ["checkout", "-b", "main"], { cwd: ext });
    execFileSync("git", ["config", "user.name", "test"], { cwd: ext });
    execFileSync("git", ["config", "user.email", "test@test"], { cwd: ext });

    await mkdir(join(ext, "alpha"));
    await writeFile(join(ext, "alpha", "a.md"), "# A\n");
    execFileSync("git", ["add", "-A"], { cwd: ext });
    execFileSync("git", ["commit", "-m", "initial commit"], { cwd: ext });
    execFileSync("git", ["push", "origin", "main"], { cwd: ext });

    const config = loadStorageConfig({
      DATA_DIR: join(dataDir, "storage-data"),
      GIT_REMOTE_URL: bare,
      LOG_LEVEL: "silent",
    });
    const storage = await GitBackend.open(config, log);

    // Initial sync / push from storage to ensure remote base is established
    await storage.transaction({ projects: ["alpha"] }, async (tx) => {
      await tx.writeFile("alpha", "b.md", "# B\n");
      return { value: null, commit };
    });

    // Remote operator rewrites history (force-push orphan commit to main)
    execFileSync("git", ["checkout", "--orphan", "scrubbed"], { cwd: ext });
    await rm(join(ext, "alpha"), { recursive: true, force: true });
    await writeFile(join(ext, "scrubbed.txt"), "clean history\n");
    execFileSync("git", ["add", "-A"], { cwd: ext });
    execFileSync("git", ["commit", "-m", "scrubbed history"], { cwd: ext });
    execFileSync("git", ["push", "--force", "origin", "scrubbed:main"], { cwd: ext });

    const remoteTipBefore = execFileSync("git", ["--git-dir", bare, "rev-parse", "main"]).toString("utf8").trim();

    // Local commit on storage while remote has rewritten history
    await storage.transaction({ projects: ["alpha"] }, async (tx) => {
      await tx.writeFile("alpha", "local-secret.md", "# Local Secret\n");
      return { value: null, commit };
    });

    const status = await storage.sync();

    // 1. Remote tip unchanged
    const remoteTipAfter = execFileSync("git", ["--git-dir", bare, "rev-parse", "main"]).toString("utf8").trim();
    expect(remoteTipAfter).toBe(remoteTipBefore);

    // 2. No conflict branches pushed to remote
    const remoteBranches = execFileSync("git", ["--git-dir", bare, "branch", "--list", "*conflict*"])
      .toString("utf8")
      .trim();
    expect(remoteBranches).toBe("");

    // 3. syncStatus/lastError reports the halt
    expect(status.lastError).toMatch(/remote history was rewritten; syncing halted/i);
    const currentStatus = await storage.syncStatus();
    expect(currentStatus.lastError).toMatch(/remote history was rewritten; syncing halted/i);

    await storage.close();
  });

  it("deleteProject and replaceProject guard against a symlinked project dir", async () => {
    const { storage } = await open();

    const outside = join(dataDir, "outside-guard");
    await mkdir(outside);
    await writeFile(join(outside, "important.txt"), "keep me");

    // Create a symlinked project root
    await symlink(outside, join(storage.repoDir, "target-proj"));

    // replaceProject removes the link and writes clean files, not writing through
    await storage.transaction({ projects: ["target-proj"] }, async (tx) => {
      await tx.replaceProject("target-proj", {
        paths: ["note.md"],
        read: async () => Buffer.from("# Replaced\n"),
      });
      return { value: null, commit };
    });

    expect(await pathExists(join(outside, "note.md"))).toBe(false);
    expect(await pathExists(join(outside, "important.txt"))).toBe(true);
    expect((await storage.readFile("target-proj", "note.md"))?.toString("utf8")).toBe("# Replaced\n");

    // Re-create symlink for deleteProject test
    await rm(join(storage.repoDir, "target-proj"), { recursive: true, force: true });
    await symlink(outside, join(storage.repoDir, "target-proj"));

    await storage.transaction({ projects: ["target-proj"] }, async (tx) => {
      await tx.deleteProject("target-proj");
      return { value: null, commit };
    });

    // Symlink removed, outside dir intact
    expect(await pathExists(join(storage.repoDir, "target-proj"))).toBe(false);
    expect(await pathExists(join(outside, "important.txt"))).toBe(true);

    await storage.close();
  });

  it("cleans up temporary SSH directory on close", async () => {
    const keyPath = join(dataDir, "test_id_ed25519");
    await writeFile(keyPath, "dummy-ssh-key-content");

    const knownHostsPath = join(dataDir, "test_known_hosts");
    await writeFile(knownHostsPath, "dummy-known-hosts");

    const config = loadStorageConfig({
      DATA_DIR: join(dataDir, "storage-data"),
      GIT_SSH_KEY_PATH: keyPath,
      GIT_SSH_KNOWN_HOSTS_PATH: knownHostsPath,
      LOG_LEVEL: "silent",
    });

    const storage = await GitBackend.open(config, log);
    const tempKeyPath = storage.git.sshKeyPath;
    expect(tempKeyPath).toBeDefined();
    if (!tempKeyPath) {
      throw new Error("expected sshKeyPath to be defined");
    }
    expect(await pathExists(tempKeyPath)).toBe(true);

    await storage.close();

    expect(await pathExists(tempKeyPath)).toBe(false);
  });
});
