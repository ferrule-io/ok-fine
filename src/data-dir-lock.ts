import { readFileSync, unlinkSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

/** Checks if a process with the given PID is alive. */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException | null)?.code === "EPERM";
  }
}

/** In-process tracking so concurrent sessions in the same process do not clobber each other's locks. */
const inProcessLocks = new Set<string>();

export type ReleaseFn = (() => void) & {
  acquired: true;
  release: () => void;
  holderPid?: undefined;
};

export interface LockFailure {
  acquired: false;
  holderPid: number | null;
  release?: undefined;
}

export type TryLockResult = ReleaseFn | LockFailure;

/**
 * Attempts to acquire the exclusive per-data-dir lock without throwing.
 * Returns a release function (callable directly or via .release()) on success,
 * or { acquired: false, holderPid } when held by another process or concurrent session.
 */
export async function tryLockDataDir(dataDir: string): Promise<TryLockResult> {
  const canonicalDir = resolve(dataDir);
  if (inProcessLocks.has(canonicalDir)) {
    return { acquired: false, holderPid: process.pid };
  }

  await mkdir(dataDir, { recursive: true });
  const lockPath = join(dataDir, "ok-fine.lock");
  const pid = String(process.pid);

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await writeFile(lockPath, `${pid}\n`, { flag: "wx" });
      inProcessLocks.add(canonicalDir);
      const releaseFn = (() => {
        inProcessLocks.delete(canonicalDir);
        try {
          if (readFileSync(lockPath, "utf8").trim() === pid) unlinkSync(lockPath);
        } catch (err) {
          if ((err as NodeJS.ErrnoException | null)?.code !== "ENOENT") throw err;
        }
      }) as ReleaseFn;
      releaseFn.acquired = true;
      releaseFn.release = releaseFn;
      return releaseFn;
    } catch (err) {
      if ((err as NodeJS.ErrnoException | null)?.code !== "EEXIST") throw err;
    }

    let content: string;
    try {
      content = (await readFile(lockPath, "utf8")).trim();
    } catch (err) {
      if ((err as NodeJS.ErrnoException | null)?.code === "ENOENT") continue;
      throw err;
    }

    const holderPid = Number.parseInt(content, 10);
    if (Number.isInteger(holderPid) && holderPid > 0) {
      if (holderPid !== process.pid && isProcessAlive(holderPid)) {
        return { acquired: false, holderPid };
      }
      if (holderPid === process.pid && inProcessLocks.has(canonicalDir)) {
        return { acquired: false, holderPid: process.pid };
      }
    }
    await rm(lockPath, { force: true });
  }

  let content: string | null = null;
  try {
    content = (await readFile(lockPath, "utf8")).trim();
  } catch {
    // ignore
  }
  const finalHolder = content ? Number.parseInt(content, 10) : null;
  return {
    acquired: false,
    holderPid: finalHolder !== null && Number.isInteger(finalHolder) && finalHolder > 0 ? finalHolder : null,
  };
}

/**
 * Takes the exclusive per-data-dir lock for a local CLI process; a lock left by a dead process is taken over.
 * Returns a synchronous release, safe to call from `process.on("exit")`.
 * Throws if already held by a live process or concurrent session.
 */
export async function lockDataDir(dataDir: string): Promise<() => void> {
  const result = await tryLockDataDir(dataDir);
  if (result.acquired) {
    return result;
  }
  const lockPath = join(dataDir, "ok-fine.lock");
  const holder = result.holderPid ?? "unknown";
  throw new Error(
    `ok-fine is already running on ${dataDir} (pid ${holder}). Close existing ok-fine sessions or pass a different --data-dir. If no ok-fine process is running, delete ${lockPath}.`,
  );
}
