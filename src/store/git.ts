import { spawn } from "node:child_process";
import { chmod, copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import type { StorageConfig } from "../config.js";
import { pathExists } from "./fs-util.js";

export class GitError extends Error {
  readonly args: string[];
  readonly code: number;
  readonly stderr: string;

  constructor(args: string[], code: number, stderr: string, configuredRemote?: string) {
    const redactedArgs = redactArgs(args, configuredRemote);
    const redactedStderr = redactStderr(stderr);
    super(`git ${redactedArgs.join(" ")} failed with exit code ${code}:\n${redactedStderr}`);
    this.name = "GitError";
    this.args = redactedArgs;
    this.code = code;
    this.stderr = redactedStderr;
  }
}

export function redactRemote(url: string): string {
  return url.replace(/(https?:\/\/)[^/@\s]+@/g, "$1");
}

export function redactArgs(args: string[], configuredRemote?: string): string[] {
  const result: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) {
      continue;
    }
    if (arg === "-m") {
      result.push("-m");
      if (i + 1 < args.length) {
        result.push("<message>");
        i++;
      }
      continue;
    }
    if (arg.startsWith("-m") && arg.length > 2) {
      result.push("-m<message>");
      continue;
    }
    if (arg === "--message") {
      result.push("--message");
      if (i + 1 < args.length) {
        result.push("<message>");
        i++;
      }
      continue;
    }
    if (arg.startsWith("--message=")) {
      result.push("--message=<message>");
      continue;
    }
    if (
      (configuredRemote && arg === configuredRemote) ||
      arg.includes("://") ||
      arg.startsWith("git@") ||
      /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(arg) ||
      /(https?:\/\/)[^/@\s]+@/.test(arg)
    ) {
      result.push(redactRemote(arg));
      continue;
    }
    result.push(arg);
  }
  return result;
}

export function redactStderr(stderr: string): string {
  const newlineIndex = stderr.indexOf("\n");
  const firstLine = newlineIndex === -1 ? stderr : stderr.slice(0, newlineIndex);
  if (/(https?:\/\/)[^/@\s]+@/.test(firstLine)) {
    const redactedFirstLine = redactRemote(firstLine);
    return newlineIndex === -1 ? redactedFirstLine : redactedFirstLine + stderr.slice(newlineIndex);
  }
  return stderr;
}

export function isPushRejection(stderr: string): boolean {
  return stderr.includes("[rejected]") || stderr.includes("non-fast-forward") || stderr.includes("fetch first");
}

const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

// Inherited values would retarget or re-author ok-fine's own repository.
const STRIPPED_HOST_GIT_ENV: Record<string, true> = {
  GIT_ALTERNATE_OBJECT_DIRECTORIES: true,
  GIT_CONFIG: true,
  GIT_CONFIG_PARAMETERS: true,
  GIT_CONFIG_COUNT: true,
  GIT_OBJECT_DIRECTORY: true,
  GIT_DIR: true,
  GIT_WORK_TREE: true,
  GIT_IMPLICIT_WORK_TREE: true,
  GIT_GRAFT_FILE: true,
  GIT_INDEX_FILE: true,
  GIT_NO_REPLACE_OBJECTS: true,
  GIT_REPLACE_REF_BASE: true,
  GIT_PREFIX: true,
  GIT_SHALLOW_FILE: true,
  GIT_COMMON_DIR: true, // `git rev-parse --local-env-vars`
  GIT_AUTHOR_NAME: true,
  GIT_AUTHOR_EMAIL: true,
  GIT_AUTHOR_DATE: true,
  GIT_COMMITTER_NAME: true,
  GIT_COMMITTER_EMAIL: true,
  GIT_COMMITTER_DATE: true,
};

export class Git {
  readonly repoDir: string;
  readonly homeDir: string;
  private readonly config: StorageConfig;
  readonly env: Record<string, string>;
  private sshTempDir?: string;
  private readonly baseArgs: string[];

  constructor(repoDir: string, homeDir: string, config: StorageConfig) {
    this.repoDir = repoDir;
    this.homeDir = homeDir;
    this.config = config;

    if (config.gitHostEnv) {
      // No HOME override and no GIT_CONFIG_NOSYSTEM: macOS osxkeychain lives in the system config.
      this.env = {
        ...Object.fromEntries(
          Object.entries(config.gitHostEnv).filter(([k]) => !Object.hasOwn(STRIPPED_HOST_GIT_ENV, k)),
        ),
        GIT_TERMINAL_PROMPT: "0",
        LC_ALL: "C",
      };
    } else {
      this.env = {
        PATH: process.env.PATH ?? "",
        HOME: homeDir,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_TERMINAL_PROMPT: "0",
        LC_ALL: "C",
      };
    }

    if (config.gitHttpUsername) {
      this.env.GIT_HTTP_USERNAME = config.gitHttpUsername;
    }
    if (config.gitHttpPassword) {
      this.env.GIT_HTTP_PASSWORD = config.gitHttpPassword;
    }

    this.baseArgs = [
      "-c",
      `safe.directory=${repoDir}`,
      "-c",
      "core.quotepath=off",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "user.name=ok-fine",
      "-c",
      "user.email=ok-fine@localhost",
      // Host git config must not run user hooks, drop files, convert line endings, or change parsed output.
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "core.excludesFile=/dev/null",
      "-c",
      "core.attributesFile=/dev/null",
      "-c",
      "core.autocrlf=false",
      "-c",
      "core.fsmonitor=false",
      "-c",
      "protocol.ext.allow=never",
      "-c",
      "log.showSignature=false",
    ];

    if (!config.gitHostEnv) {
      this.baseArgs.push("-c", "core.sshCommand=");
    }

    if (config.gitHttpUsername && config.gitHttpPassword) {
      this.baseArgs.push(
        "-c",
        "credential.helper=",
        "-c",
        "credential.helper=!f() { echo username=$GIT_HTTP_USERNAME; echo password=$GIT_HTTP_PASSWORD; }; f",
      );
    }
  }

  get sshKeyPath(): string | undefined {
    return this.sshTempDir ? join(this.sshTempDir, "id_okf") : undefined;
  }

  async close(): Promise<void> {
    if (this.sshTempDir) {
      try {
        await rm(this.sshTempDir, { recursive: true, force: true });
      } finally {
        this.sshTempDir = undefined;
      }
    }
  }

  async prepareSsh(): Promise<void> {
    if (!this.config.gitSshKeyPath) {
      return;
    }

    try {
      await rm(join(this.homeDir, ".ssh", "id_okf"), { force: true });
    } catch {
      // Ignore if homeDir or .ssh directory does not exist
    }

    if (!this.sshTempDir) {
      this.sshTempDir = await mkdtemp(join(tmpdir(), "okf-ssh-"));
      await chmod(this.sshTempDir, 0o700);
    }

    const targetKeyPath = join(this.sshTempDir, "id_okf");
    await copyFile(this.config.gitSshKeyPath, targetKeyPath);
    await chmod(targetKeyPath, 0o600);

    let sshCmd = `ssh -i "${targetKeyPath}" -o IdentitiesOnly=yes -o BatchMode=yes`;
    // The chart always sets the path; the Secret key is optional, so strict mode requires the file to exist.
    const knownHosts = this.config.gitSshKnownHostsPath;
    if (knownHosts) {
      if (!(await pathExists(knownHosts))) {
        throw new Error(`Configured known_hosts file does not exist: ${knownHosts}`);
      }
      sshCmd += ` -o UserKnownHostsFile="${knownHosts}" -o StrictHostKeyChecking=yes`;
    } else {
      sshCmd += ` -o UserKnownHostsFile="${join(this.sshTempDir, "known_hosts")}" -o StrictHostKeyChecking=accept-new`;
    }

    this.env.GIT_SSH_COMMAND = sshCmd;
  }

  run(
    args: string[],
    opts?: { allowFail?: boolean; stdin?: Buffer | string },
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    const { promise, resolve, reject } = Promise.withResolvers<{
      code: number;
      stdout: string;
      stderr: string;
    }>();

    const allArgs = [...this.baseArgs, ...args];
    // spawn, not execFile: execFile does not forward `detached`.
    const child = spawn("git", allArgs, {
      cwd: this.repoDir,
      env: this.env,
      stdio: ["pipe", "pipe", "pipe"],
      // Own session, no controlling terminal: ssh/credential prompts fail instead of taking over the MCP client's terminal.
      detached: true,
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let outputBytes = 0;
    let overflow = false;
    const collect = (chunks: Buffer[]) => (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_OUTPUT_BYTES) {
        overflow = true;
        child.kill();
        return;
      }
      chunks.push(chunk);
    };
    child.stdout.on("data", collect(stdoutChunks));
    child.stderr.on("data", collect(stderrChunks));

    let settled = false;
    const settle = (code: number, failed: boolean, extraStderr = ""): void => {
      if (settled) return;
      settled = true;
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8") + extraStderr;
      if (failed && !opts?.allowFail) {
        reject(new GitError(args, code, stderr, this.config.gitRemoteUrl));
      } else {
        resolve({ code, stdout, stderr });
      }
    };
    child.on("error", (err) => settle(1, true, err.message));
    child.on("close", (code) => {
      if (overflow) settle(1, true, "\noutput exceeded the 64 MiB limit");
      else settle(code ?? 1, code !== 0);
    });

    // EPIPE when git exits without reading stdin surfaces through the exit code.
    child.stdin.on("error", () => undefined);
    child.stdin.end(opts?.stdin);

    return promise;
  }

  spawnStdout(args: string[]): Readable {
    const allArgs = [...this.baseArgs, ...args];
    const child = spawn("git", allArgs, {
      cwd: this.repoDir,
      env: this.env,
      stdio: ["ignore", "pipe", "pipe"],
      // Own session, no controlling terminal: ssh/credential prompts fail instead of taking over the MCP client's terminal.
      detached: true,
    });

    let stderrBuffer = "";
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderrBuffer += chunk.toString();
    });

    child.on("close", (code) => {
      if (code !== 0 && code !== null) {
        child.stdout.destroy(new GitError(args, code, stderrBuffer, this.config.gitRemoteUrl));
      }
    });

    return child.stdout;
  }
}
