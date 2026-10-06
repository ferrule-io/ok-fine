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
});
