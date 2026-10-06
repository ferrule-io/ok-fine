import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { lockDataDir } from "./data-dir-lock.js";
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

  it("refuses a data dir held by a live process and names it", async () => {
    await writeFile(lockPath, `${process.ppid}\n`);
    await expect(lockDataDir(dataDir)).rejects.toThrow(
      `ok-fine is already running on ${dataDir} (pid ${process.ppid})`,
    );
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
});
