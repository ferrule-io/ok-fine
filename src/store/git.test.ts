import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadStorageConfig } from "../config.js";
import { pathExists } from "./fs-util.js";
import { Git, GitError, redactStderr } from "./git.js";

describe("Git", () => {
  let dataDir: string;
  let repoDir: string;
  let homeDir: string;
  let git: Git | undefined;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "okf-"));
    repoDir = join(dataDir, "repo");
    homeDir = join(dataDir, "home");
  });

  afterEach(async () => {
    if (git) {
      await git.close();
      git = undefined;
    }
    await rm(dataDir, { recursive: true, force: true });
  });

  it("redacts https userinfo remote from GitError message when git command fails", async () => {
    const config = loadStorageConfig({ DATA_DIR: dataDir });
    git = new Git(repoDir, homeDir, config);

    const invalidRemote = "https://user:secret-token@127.0.0.1:1/repo.git";
    let caught: GitError | undefined;
    try {
      await git.run(["remote", "set-url", "origin", invalidRemote]);
    } catch (err) {
      caught = err as GitError;
    }

    expect(caught).toBeInstanceOf(GitError);
    expect(caught?.message).not.toContain("secret-token");
    expect(caught?.message).toContain("https://127.0.0.1:1/repo.git");
    expect(caught?.args).not.toContain(invalidRemote);
    expect(caught?.args).toContain("https://127.0.0.1:1/repo.git");
  });

  it("redacts -m commit message values from GitError message when git command fails", async () => {
    const config = loadStorageConfig({ DATA_DIR: dataDir });
    git = new Git(repoDir, homeDir, config);

    const secretMsg = "super-secret-commit-message-12345";
    const secretBody = "even-more-secret-commit-body-67890";
    let caught: GitError | undefined;
    try {
      await git.run(["commit", "-m", secretMsg, "-m", secretBody]);
    } catch (err) {
      caught = err as GitError;
    }

    expect(caught).toBeInstanceOf(GitError);
    expect(caught?.message).not.toContain(secretMsg);
    expect(caught?.message).not.toContain(secretBody);
    expect(caught?.message).toContain("-m <message>");
    expect(caught?.args).not.toContain(secretMsg);
    expect(caught?.args).not.toContain(secretBody);
    expect(caught?.args).toEqual(["commit", "-m", "<message>", "-m", "<message>"]);
  });

  it("redacts first stderr line only if it contains userinfo", () => {
    const withUserinfo =
      "fatal: unable to access 'https://user:password@github.com/org/repo.git': Failed to connect\nsome detail";
    const redacted = redactStderr(withUserinfo);
    expect(redacted).not.toContain("password");
    expect(redacted).toContain("https://github.com/org/repo.git");
    expect(redacted).toContain("some detail");

    const withoutUserinfo = "fatal: not a git repository\nsome detail";
    expect(redactStderr(withoutUserinfo)).toBe(withoutUserinfo);

    const userinfoOnSecondLine = "error: something failed\nfatal: https://user:password@github.com/repo";
    expect(redactStderr(userinfoOnSecondLine)).toBe(userinfoOnSecondLine);
  });

  it("redacts configured remote matching arg from GitError message", async () => {
    const remoteUrl = "https://svc-user:svc-pass@example.com/repo.git";
    const config = loadStorageConfig({ DATA_DIR: dataDir, GIT_REMOTE_URL: remoteUrl });
    git = new Git(repoDir, homeDir, config);

    let caught: GitError | undefined;
    try {
      await git.run(["push", remoteUrl, "main"]);
    } catch (err) {
      caught = err as GitError;
    }

    expect(caught).toBeInstanceOf(GitError);
    expect(caught?.message).not.toContain("svc-pass");
    expect(caught?.message).toContain("https://example.com/repo.git");
  });

  it("rejects prepareSsh when configured known_hosts path does not exist", async () => {
    const keyPath = join(dataDir, "test_id_ed25519");
    await writeFile(keyPath, "dummy-ssh-key");

    const missingKnownHosts = join(dataDir, "nonexistent_known_hosts");
    const config = loadStorageConfig({
      DATA_DIR: dataDir,
      GIT_SSH_KEY_PATH: keyPath,
      GIT_SSH_KNOWN_HOSTS_PATH: missingKnownHosts,
    });
    git = new Git(repoDir, homeDir, config);

    await expect(git.prepareSsh()).rejects.toThrow(missingKnownHosts);
  });

  it("puts ssh key under os.tmpdir() instead of DATA_DIR and removes stale key", async () => {
    const keyPath = join(dataDir, "test_id_ed25519");
    await writeFile(keyPath, "dummy-ssh-key-content");

    // Put a stale key in DATA_DIR/home/.ssh/id_okf
    const staleSshDir = join(homeDir, ".ssh");
    const staleKeyPath = join(staleSshDir, "id_okf");
    await mkdir(staleSshDir, { recursive: true });
    await writeFile(staleKeyPath, "stale-key");

    const config = loadStorageConfig({
      DATA_DIR: dataDir,
      GIT_SSH_KEY_PATH: keyPath,
    });
    git = new Git(repoDir, homeDir, config);

    await git.prepareSsh();

    // Verify stale key in homeDir was removed
    expect(await pathExists(staleKeyPath)).toBe(false);

    // Verify key was placed in a temp directory under tmpdir(), not dataDir
    const sshCommand = git.env.GIT_SSH_COMMAND;
    expect(sshCommand).toBeDefined();
    expect(sshCommand).toContain("-i ");
    expect(sshCommand).not.toContain(dataDir);
    expect(sshCommand).toContain(tmpdir());
    expect(sshCommand).toContain("StrictHostKeyChecking=accept-new");

    const keyMatch = /-i "([^"]+)"/.exec(sshCommand ?? "");
    expect(keyMatch).not.toBeNull();
    const copiedKeyPath = keyMatch?.[1] ?? "";
    expect(copiedKeyPath.startsWith(tmpdir())).toBe(true);
    expect(await pathExists(copiedKeyPath)).toBe(true);

    // Verify file and directory permissions
    const fileStat = await stat(copiedKeyPath);
    expect(fileStat.mode & 0o777).toBe(0o600);

    const dirStat = await stat(join(copiedKeyPath, ".."));
    expect(dirStat.mode & 0o777).toBe(0o700);

    // Verify calling prepareSsh a second time reuses the directory
    await git.prepareSsh();
    const secondSshCommand = git.env.GIT_SSH_COMMAND;
    expect(secondSshCommand).toBe(sshCommand);

    // Verify close removes temp dir
    await git.close();
    expect(await pathExists(copiedKeyPath)).toBe(false);
  });

  it("configures hardening options on git invocations", async () => {
    await mkdir(repoDir, { recursive: true });
    await mkdir(homeDir, { recursive: true });

    const config = loadStorageConfig({ DATA_DIR: dataDir });
    git = new Git(repoDir, homeDir, config);

    await git.run(["init", "-b", "main"]);

    // Verify core.fsmonitor=false, core.sshCommand=, protocol.ext.allow=never take effect
    const fsmonitor = await git.run(["config", "core.fsmonitor"]);
    expect(fsmonitor.stdout.trim()).toBe("false");

    const extAllow = await git.run(["config", "protocol.ext.allow"]);
    expect(extAllow.stdout.trim()).toBe("never");

    const sshCmd = await git.run(["config", "core.sshCommand"]);
    expect(sshCmd.stdout.trim()).toBe("");
  });

  it("does not neutralize core.sshCommand when gitHostEnv is set, but keeps fsmonitor and protocol hardening", async () => {
    await mkdir(repoDir, { recursive: true });
    await mkdir(homeDir, { recursive: true });

    const config = loadStorageConfig(
      { DATA_DIR: dataDir, PATH: process.env.PATH ?? "/usr/bin:/bin" },
      { inheritGitEnv: true },
    );
    expect(config.gitHostEnv).toBeDefined();

    git = new Git(repoDir, homeDir, config);
    await git.run(["init", "-b", "main"]);

    await git.run(["config", "core.sshCommand", "ssh -v"]);
    const sshCmd = await git.run(["config", "core.sshCommand"]);
    expect(sshCmd.stdout.trim()).toBe("ssh -v");

    const fsmonitor = await git.run(["config", "core.fsmonitor"]);
    expect(fsmonitor.stdout.trim()).toBe("false");

    const extAllow = await git.run(["config", "protocol.ext.allow"]);
    expect(extAllow.stdout.trim()).toBe("never");
  });
});
