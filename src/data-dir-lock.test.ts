import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
});
