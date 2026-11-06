import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isProcessAlive, lockDataDir, tryLockDataDir } from "./data-dir-lock.js";
import { pathExists } from "./store/fs-util.js";

describe("lockDataDir", () => {
  let dataDir: string;
  let lockPath: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "okf-"));
    lockPath = join(dataDir, "ok-fine.lock");
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("refuses a data dir held by a live process and does not suggest serve", async () => {
    await writeFile(lockPath, `${process.ppid}\n`);
    let caught: Error | undefined;
    try {
      await lockDataDir(dataDir);
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).toBeDefined();
    expect(caught?.message).toContain(`ok-fine is already running on ${dataDir} (pid ${process.ppid})`);
    expect(caught?.message).not.toContain("connect more clients to `ok-fine serve`");
    expect((await readFile(lockPath, "utf8")).trim()).toBe(String(process.ppid));
  });

  it("takes over a lock left by an exited process and releases it", async () => {
    const deadPid = spawnSync(process.execPath, ["-e", ""]).pid;
    await writeFile(lockPath, `${deadPid}\n`);

    const release = await lockDataDir(dataDir);
    expect((await readFile(lockPath, "utf8")).trim()).toBe(String(process.pid));

    release();
    expect(await pathExists(lockPath)).toBe(false);
  });

  it("tryLockDataDir returns release function on success and failure when locked", async () => {
    const first = await tryLockDataDir(dataDir);
    expect(first.acquired).toBe(true);
    if (!first.acquired) throw new Error("expected lock to be acquired");

    // Second acquisition in same process fails without deleting lock
    const second = await tryLockDataDir(dataDir);
    expect(second.acquired).toBe(false);
    expect(second.holderPid).toBe(process.pid);

    first.release();
    expect(await pathExists(lockPath)).toBe(false);

    // Now third acquisition succeeds
    const third = await tryLockDataDir(dataDir);
    expect(third.acquired).toBe(true);
    if (third.acquired) third.release();
  });

  it("isProcessAlive checks PID liveness", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
    const deadPid = spawnSync(process.execPath, ["-e", ""]).pid;
    expect(isProcessAlive(deadPid)).toBe(false);
  });

  it("takes over a lock with garbage or empty content older than threshold", async () => {
    const tenSecondsAgo = new Date(Date.now() - 10_000);

    await writeFile(lockPath, "not-a-number\n");
    await utimes(lockPath, tenSecondsAgo, tenSecondsAgo);
    const release1 = await lockDataDir(dataDir);
    expect((await readFile(lockPath, "utf8")).trim()).toBe(String(process.pid));
    release1();

    await writeFile(lockPath, "\n");
    await utimes(lockPath, tenSecondsAgo, tenSecondsAgo);
    const release2 = await lockDataDir(dataDir);
    expect((await readFile(lockPath, "utf8")).trim()).toBe(String(process.pid));
    release2();
  });

  it("does not take over a fresh empty lock file and preserves it", async () => {
    await writeFile(lockPath, "");
    const result = await tryLockDataDir(dataDir);
    expect(result.acquired).toBe(false);
    expect(result.holderPid).toBeNull();
    expect(await pathExists(lockPath)).toBe(true);
    expect(await readFile(lockPath, "utf8")).toBe("");
  });

  it("does not take over stale lock when a newer generation guard is held by a live process", async () => {
    const deadPid = spawnSync(process.execPath, ["-e", ""]).pid;
    await writeFile(lockPath, `${deadPid}\n`);
    const tenSecondsAgo = new Date(Date.now() - 10_000);
    await utimes(lockPath, tenSecondsAgo, tenSecondsAgo);

    const stats = await stat(lockPath, { bigint: true });
    const lockKey = `${stats.ino}-${stats.mtimeNs}`;
    const gen0Path = join(dataDir, `ok-fine.lock.takeover-${lockKey}.0`);
    const gen1Path = join(dataDir, `ok-fine.lock.takeover-${lockKey}.1`);

    await writeFile(gen0Path, `${deadPid}\n`);

    const liveChild = spawn(process.execPath, ["-e", "setTimeout(() => {}, 10000)"]);
    try {
      await writeFile(gen1Path, `${liveChild.pid}\n`);

      const result = await tryLockDataDir(dataDir);
      expect(result.acquired).toBe(false);
      expect(await readFile(lockPath, "utf8")).toBe(`${deadPid}\n`);
    } finally {
      liveChild.kill();
    }
  });

  it("takes over stale lock when gen 0 guard is dead and cleans up takeover guards", async () => {
    const deadPid = spawnSync(process.execPath, ["-e", ""]).pid;
    await writeFile(lockPath, `${deadPid}\n`);
    const tenSecondsAgo = new Date(Date.now() - 10_000);
    await utimes(lockPath, tenSecondsAgo, tenSecondsAgo);

    const stats = await stat(lockPath, { bigint: true });
    const lockKey = `${stats.ino}-${stats.mtimeNs}`;
    const gen0Path = join(dataDir, `ok-fine.lock.takeover-${lockKey}.0`);
    await writeFile(gen0Path, `${deadPid}\n`);

    const release = await lockDataDir(dataDir);
    expect((await readFile(lockPath, "utf8")).trim()).toBe(String(process.pid));
    release();

    expect(await pathExists(lockPath)).toBe(false);
    const entries = await readdir(dataDir);
    const takeoverFiles = entries.filter((e) => e.startsWith("ok-fine.lock.takeover-"));
    expect(takeoverFiles).toHaveLength(0);
  });
  it("takes over stale lock when generations 0..11 all have dead holders and cleans up guards", async () => {
    const deadPid = spawnSync(process.execPath, ["-e", ""]).pid;
    await writeFile(lockPath, `${deadPid}\n`);
    const tenSecondsAgo = new Date(Date.now() - 10_000);
    await utimes(lockPath, tenSecondsAgo, tenSecondsAgo);

    const stats = await stat(lockPath, { bigint: true });
    const lockKey = `${stats.ino}-${stats.mtimeNs}`;
    for (let gen = 0; gen < 12; gen++) {
      await writeFile(join(dataDir, `ok-fine.lock.takeover-${lockKey}.${gen}`), `${deadPid}\n`);
    }

    const result = await tryLockDataDir(dataDir);
    expect(result.acquired).toBe(true);
    if (!result.acquired) throw new Error("expected lock to be acquired");
    result.release();

    expect(await pathExists(lockPath)).toBe(false);
    const entries = await readdir(dataDir);
    const takeoverFiles = entries.filter((e) => e.startsWith("ok-fine.lock.takeover-"));
    expect(takeoverFiles).toHaveLength(0);
  });

  it("serializes concurrent stale takeover so exactly one process acquires", async () => {
    const lockModuleUrl = new URL("./data-dir-lock.ts", import.meta.url).href;
    const childCode = `
import { tryLockDataDir } from ${JSON.stringify(lockModuleUrl)};
const targetDir = process.argv[1];
try {
  const res = await tryLockDataDir(targetDir);
  if (res.acquired) {
    process.stdout.write("ACQUIRED " + process.pid + "\\n");
    // Subprocess must stay alive using wall-clock time so its PID remains live to OS isProcessAlive checks while other children decide.
    await new Promise((resolve) => setTimeout(resolve, 800));
    res.release();
  } else {
    process.stdout.write("HELD " + (res.holderPid ?? "null") + "\\n");
  }
} catch (err) {
  process.stderr.write("ERR: " + (err instanceof Error ? err.stack : String(err)) + "\\n");
}
`;

    for (let run = 0; run < 5; run++) {
      const runDir = await mkdtemp(join(tmpdir(), "okf-takeover-race-"));
      const runLockPath = join(runDir, "ok-fine.lock");
      const deadPid = spawnSync(process.execPath, ["-e", ""]).pid;
      expect(isProcessAlive(deadPid)).toBe(false);
      await writeFile(runLockPath, `${deadPid}\n`);

      const children = Array.from({ length: 6 }, () => {
        const child = spawn(process.execPath, ["--experimental-strip-types", "-e", childCode, runDir], {
          stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
          stdout += chunk;
        });
        child.stderr.on("data", (chunk: string) => {
          stderr += chunk;
        });

        const { promise: firstLinePromise, resolve: resolveFirstLine } = Promise.withResolvers<string>();
        let lineResolved = false;
        child.stdout.on("data", () => {
          if (!lineResolved && stdout.includes("\n")) {
            lineResolved = true;
            const [first] = stdout.split("\n");
            resolveFirstLine(first?.trim() ?? "");
          }
        });
        child.on("close", () => {
          if (!lineResolved) {
            lineResolved = true;
            const [first] = stdout.split("\n");
            resolveFirstLine(first?.trim() ?? "");
          }
        });

        const { promise: exitPromise, resolve: resolveExit } = Promise.withResolvers<{
          code: number | null;
          stdout: string;
          stderr: string;
        }>();
        child.on("close", (code) => {
          resolveExit({ code, stdout, stderr });
        });

        return { child, firstLinePromise, exitPromise };
      });

      const lines = await Promise.all(children.map((c) => c.firstLinePromise));
      const acquired = lines.filter((l) => l.startsWith("ACQUIRED "));
      const held = lines.filter((l) => l.startsWith("HELD "));

      expect(acquired).toHaveLength(1);
      expect(held).toHaveLength(5);

      const winnerPid = acquired[0]?.split(" ")[1] ?? "";
      expect(Number.parseInt(winnerPid, 10)).toBeGreaterThan(0);

      const currentLock = (await readFile(runLockPath, "utf8")).trim();
      expect(currentLock).toBe(winnerPid);

      const exits = await Promise.all(children.map((c) => c.exitPromise));
      for (const exit of exits) {
        expect(exit.code).toBe(0);
        expect(exit.stderr).toBe("");
      }

      await rm(runDir, { recursive: true, force: true });
    }
  }, 30_000);

  it("serializes concurrent stale takeover seeded with dead-pid gen-0 guard", async () => {
    const lockModuleUrl = new URL("./data-dir-lock.ts", import.meta.url).href;
    const childCode = `
import { tryLockDataDir } from ${JSON.stringify(lockModuleUrl)};
const targetDir = process.argv[1];
try {
  const res = await tryLockDataDir(targetDir);
  if (res.acquired) {
    process.stdout.write("ACQUIRED " + process.pid + "\\n");
    // Subprocess must stay alive using wall-clock time so its PID remains live to OS isProcessAlive checks while other children decide.
    await new Promise((resolve) => setTimeout(resolve, 800));
    res.release();
  } else {
    process.stdout.write("HELD " + (res.holderPid ?? "null") + "\\n");
  }
} catch (err) {
  process.stderr.write("ERR: " + (err instanceof Error ? err.stack : String(err)) + "\\n");
}
`;

    for (let run = 0; run < 5; run++) {
      const runDir = await mkdtemp(join(tmpdir(), "okf-takeover-race-gen-"));
      const runLockPath = join(runDir, "ok-fine.lock");
      const deadPid = spawnSync(process.execPath, ["-e", ""]).pid;
      expect(isProcessAlive(deadPid)).toBe(false);
      await writeFile(runLockPath, `${deadPid}\n`);
      const tenSecondsAgo = new Date(Date.now() - 10_000);
      await utimes(runLockPath, tenSecondsAgo, tenSecondsAgo);

      const stats = await stat(runLockPath, { bigint: true });
      const lockKey = `${stats.ino}-${stats.mtimeNs}`;
      await writeFile(join(runDir, `ok-fine.lock.takeover-${lockKey}.0`), `${deadPid}\n`);

      const children = Array.from({ length: 6 }, () => {
        const child = spawn(process.execPath, ["--experimental-strip-types", "-e", childCode, runDir], {
          stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
          stdout += chunk;
        });
        child.stderr.on("data", (chunk: string) => {
          stderr += chunk;
        });

        const { promise: firstLinePromise, resolve: resolveFirstLine } = Promise.withResolvers<string>();
        let lineResolved = false;
        child.stdout.on("data", () => {
          if (!lineResolved && stdout.includes("\n")) {
            lineResolved = true;
            const [first] = stdout.split("\n");
            resolveFirstLine(first?.trim() ?? "");
          }
        });
        child.on("close", () => {
          if (!lineResolved) {
            lineResolved = true;
            const [first] = stdout.split("\n");
            resolveFirstLine(first?.trim() ?? "");
          }
        });

        const { promise: exitPromise, resolve: resolveExit } = Promise.withResolvers<{
          code: number | null;
          stdout: string;
          stderr: string;
        }>();
        child.on("close", (code) => {
          resolveExit({ code, stdout, stderr });
        });

        return { child, firstLinePromise, exitPromise };
      });

      const lines = await Promise.all(children.map((c) => c.firstLinePromise));
      const acquired = lines.filter((l) => l.startsWith("ACQUIRED "));
      const held = lines.filter((l) => l.startsWith("HELD "));

      expect(acquired).toHaveLength(1);
      expect(held).toHaveLength(5);

      const winnerPid = acquired[0]?.split(" ")[1] ?? "";
      expect(Number.parseInt(winnerPid, 10)).toBeGreaterThan(0);

      const currentLock = (await readFile(runLockPath, "utf8")).trim();
      expect(currentLock).toBe(winnerPid);

      const exits = await Promise.all(children.map((c) => c.exitPromise));
      for (const exit of exits) {
        expect(exit.code).toBe(0);
        expect(exit.stderr).toBe("");
      }

      await rm(runDir, { recursive: true, force: true });
    }
  }, 30_000);
});
