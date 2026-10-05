import { execFile, spawn } from "node:child_process";
import { chmod, copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Readable } from "node:stream";
import type { Config } from "../config.js";
import { pathExists } from "./fs-util.js";

export class GitError extends Error {
  readonly args: string[];
  readonly code: number;
  readonly stderr: string;

  constructor(args: string[], code: number, stderr: string) {
    super(`git ${args.join(" ")} failed with exit code ${code}:\n${stderr}`);
    this.name = "GitError";
    this.args = args;
    this.code = code;
    this.stderr = stderr;
  }
}

export function redactRemote(url: string): string {
  return url.replace(/(https?:\/\/)[^/@\s]+@/g, "$1");
}

export function isPushRejection(stderr: string): boolean {
  return stderr.includes("[rejected]") || stderr.includes("non-fast-forward") || stderr.includes("fetch first");
}

export class Git {
  readonly repoDir: string;
  readonly homeDir: string;
  private readonly config: Config;
  private readonly env: Record<string, string>;
  private readonly baseArgs: string[];

  constructor(repoDir: string, homeDir: string, config: Config) {
    this.repoDir = repoDir;
    this.homeDir = homeDir;
    this.config = config;

    this.env = {
      PATH: process.env.PATH ?? "",
      HOME: homeDir,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
      LC_ALL: "C",
    };

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
    ];

    if (config.gitHttpUsername && config.gitHttpPassword) {
      this.baseArgs.push(
        "-c",
        "credential.helper=",
        "-c",
        "credential.helper=!f() { echo username=$GIT_HTTP_USERNAME; echo password=$GIT_HTTP_PASSWORD; }; f",
      );
    }
  }

  async prepareSsh(): Promise<void> {
    if (!this.config.gitSshKeyPath) {
      return;
    }

    const sshDir = join(this.homeDir, ".ssh");
    await mkdir(sshDir, { recursive: true, mode: 0o700 });
    const targetKeyPath = join(sshDir, "id_okf");
    await copyFile(this.config.gitSshKeyPath, targetKeyPath);
    await chmod(targetKeyPath, 0o600);

    let sshCmd = `ssh -i "${targetKeyPath}" -o IdentitiesOnly=yes -o BatchMode=yes`;
    // The chart always sets the path; the Secret key is optional, so strict mode requires the file to exist.
    const knownHosts = this.config.gitSshKnownHostsPath;
    if (knownHosts && (await pathExists(knownHosts))) {
      sshCmd += ` -o UserKnownHostsFile="${knownHosts}" -o StrictHostKeyChecking=yes`;
    } else {
      sshCmd += ` -o UserKnownHostsFile="${join(sshDir, "known_hosts")}" -o StrictHostKeyChecking=accept-new`;
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
    const child = execFile(
      "git",
      allArgs,
      {
        cwd: this.repoDir,
        env: this.env,
        maxBuffer: 64 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        const stdoutStr = Buffer.isBuffer(stdout) ? stdout.toString("utf8") : String(stdout ?? "");
        const stderrStr = Buffer.isBuffer(stderr) ? stderr.toString("utf8") : String(stderr ?? "");
        const code = child.exitCode ?? (error ? 1 : 0);

        if (error && !opts?.allowFail) {
          reject(new GitError(args, code, stderrStr));
        } else {
          resolve({ code, stdout: stdoutStr, stderr: stderrStr });
        }
      },
    );

    if (opts?.stdin != null && child.stdin) {
      child.stdin.end(opts.stdin);
    }

    return promise;
  }

  spawnStdout(args: string[]): Readable {
    const allArgs = [...this.baseArgs, ...args];
    const child = spawn("git", allArgs, {
      cwd: this.repoDir,
      env: this.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderrBuffer = "";
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderrBuffer += chunk.toString();
    });

    child.on("close", (code) => {
      if (code !== 0 && code !== null) {
        child.stdout.destroy(new GitError(args, code, stderrBuffer));
      }
    });

    return child.stdout;
  }
}
