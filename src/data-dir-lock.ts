import { readFileSync, unlinkSync } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

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
const inProcessQueues = new Map<string, Promise<unknown>>();
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

interface LockContentState {
  raw: string;
  trimmed: string;
  holderPid: number | null;
  mtimeMs: number;
  ino: bigint;
  mtimeNs: bigint;
  isStale: boolean;
  isLiveOther: boolean;
  isContention: boolean;
}

function parseLockContent(
  raw: string,
  mtimeMs: number,
  ino: bigint,
  mtimeNs: bigint,
  canonicalDir: string,
): LockContentState {
  const trimmed = raw.trim();
  const parsed = Number.parseInt(trimmed, 10);
  const validPid = Number.isInteger(parsed) && parsed > 0 ? parsed : null;

  if (validPid !== null) {
    if (validPid !== process.pid) {
      if (isProcessAlive(validPid)) {
        return {
          raw,
          trimmed,
          holderPid: validPid,
          mtimeMs,
          ino,
          mtimeNs,
          isStale: false,
          isLiveOther: true,
          isContention: false,
        };
      }
      return {
        raw,
        trimmed,
        holderPid: validPid,
        mtimeMs,
        ino,
        mtimeNs,
        isStale: true,
        isLiveOther: false,
        isContention: false,
      };
    }
    const inProcess = inProcessLocks.has(canonicalDir);
    const isOld = Date.now() - mtimeMs > STALE_THRESHOLD_MS;
    return {
      raw,
      trimmed,
      holderPid: process.pid,
      mtimeMs,
      ino,
      mtimeNs,
      isStale: !inProcess && isOld,
      isLiveOther: false,
      isContention: !inProcess && !isOld,
    };
  }

  // Not a valid positive integer (empty or non-pid content).
  // Mid-write hole: writeFile creates the file (O_CREAT|O_EXCL) before writing content.
  // Treat as stale only if older than STALE_THRESHOLD_MS; otherwise treat as in-flight contention.
  const isOld = Date.now() - mtimeMs > STALE_THRESHOLD_MS;
  return {
    raw,
    trimmed,
    holderPid: null,
    mtimeMs,
    ino,
    mtimeNs,
    isStale: isOld,
    isLiveOther: false,
    isContention: !isOld,
  };
}

async function readLockState(lockPath: string, canonicalDir: string): Promise<LockContentState | null> {
  try {
    const [raw, stats] = await Promise.all([readFile(lockPath, "utf8"), stat(lockPath, { bigint: true })]);
    return parseLockContent(raw, Number(stats.mtimeMs), stats.ino, stats.mtimeNs, canonicalDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException | null)?.code === "ENOENT") return null;
    throw err;
  }
}

async function cleanupOldTakeoverGuards(dataDir: string, currentKey: string | null): Promise<void> {
  try {
    const entries = await readdir(dataDir);
    const prefix = "ok-fine.lock.takeover-";
    const currentPrefix = currentKey ? `${prefix}${currentKey}.` : null;
    for (const entry of entries) {
      if (entry.startsWith(prefix)) {
        if (!currentPrefix || !entry.startsWith(currentPrefix)) {
          await rm(join(dataDir, entry), { force: true }).catch(() => {});
        }
      }
    }
  } catch {
    // hygiene only; ignore errors
  }
}

const STALE_THRESHOLD_MS = 3000;
const MAX_LOCK_ATTEMPTS = 10;
const MAX_TAKEOVER_GENS = 10_000;

/**
 * Attempts to acquire the exclusive per-data-dir lock without throwing.
 * Returns a release function (callable directly or via .release()) on success,
 * or { acquired: false, holderPid } when held by another process or concurrent session.
 */
export async function tryLockDataDir(dataDir: string): Promise<TryLockResult> {
  const canonicalDir = resolve(dataDir);
  while (inProcessQueues.has(canonicalDir)) {
    try {
      await inProcessQueues.get(canonicalDir);
    } catch {
      // ignore
    }
  }
  if (inProcessLocks.has(canonicalDir)) {
    return { acquired: false, holderPid: process.pid };
  }

  const { promise, resolve: resolveQueue } = Promise.withResolvers<void>();
  inProcessQueues.set(canonicalDir, promise);
  try {
    return await doTryLockDataDir(dataDir, canonicalDir);
  } finally {
    inProcessQueues.delete(canonicalDir);
    resolveQueue();
  }
}

async function doTryLockDataDir(dataDir: string, canonicalDir: string): Promise<TryLockResult> {
  await mkdir(dataDir, { recursive: true });
  const lockPath = join(dataDir, "ok-fine.lock");
  const pid = String(process.pid);

  const makeReleaseFn = (): ReleaseFn => {
    const releaseFn = (() => {
      try {
        if (readFileSync(lockPath, "utf8").trim() === pid) unlinkSync(lockPath);
      } catch (err) {
        if ((err as NodeJS.ErrnoException | null)?.code !== "ENOENT") throw err;
      } finally {
        inProcessLocks.delete(canonicalDir);
      }
    }) as ReleaseFn;
    releaseFn.acquired = true;
    releaseFn.release = releaseFn;
    return releaseFn;
  };

  for (let attempt = 0; attempt < MAX_LOCK_ATTEMPTS; attempt++) {
    try {
      await writeFile(lockPath, `${pid}\n`, { flag: "wx" });
      inProcessLocks.add(canonicalDir);
      const newLockStats = await stat(lockPath, { bigint: true }).catch(() => null);
      const currentKey = newLockStats ? `${newLockStats.ino}-${newLockStats.mtimeNs}` : null;
      await cleanupOldTakeoverGuards(dataDir, currentKey);
      return makeReleaseFn();
    } catch (err) {
      if ((err as NodeJS.ErrnoException | null)?.code !== "EEXIST") throw err;
    }

    const lockState = await readLockState(lockPath, canonicalDir);
    if (!lockState) {
      continue;
    }

    if (lockState.isLiveOther) {
      return { acquired: false, holderPid: lockState.holderPid };
    }

    if (lockState.holderPid === process.pid && inProcessLocks.has(canonicalDir)) {
      return { acquired: false, holderPid: process.pid };
    }

    if (lockState.isContention) {
      // In-flight write to ok-fine.lock (e.g. file is 0 bytes right after O_CREAT before content write).
      // Sleep briefly and retry.
      const delayMs = 15 + Math.floor(Math.random() * 20);
      await sleep(delayMs);
      continue;
    }

    // Stale lock observed. Key the takeover right by the stale lock instance (ino-mtimeNs).
    const lockKey = `${lockState.ino}-${lockState.mtimeNs}`;
    let rightHeld = false;
    let guardContention = false;

    for (let gen = 0; ; gen++) {
      if (gen >= MAX_TAKEOVER_GENS) {
        throw new Error(`Exceeded takeover generation scan limit (${MAX_TAKEOVER_GENS}) for lock key ${lockKey}`);
      }
      const guardPath = join(dataDir, `ok-fine.lock.takeover-${lockKey}.${gen}`);
      try {
        await writeFile(guardPath, `${pid}\n`, { flag: "wx" });
        rightHeld = true;
        break;
      } catch (err) {
        if ((err as NodeJS.ErrnoException | null)?.code !== "EEXIST") throw err;
      }

      let guardRaw: string;
      let guardMtimeMs: number;
      try {
        const [content, stats] = await Promise.all([readFile(guardPath, "utf8"), stat(guardPath)]);
        guardRaw = content;
        guardMtimeMs = stats.mtimeMs;
      } catch (err) {
        if ((err as NodeJS.ErrnoException | null)?.code === "ENOENT") {
          guardContention = true;
          break;
        }
        throw err;
      }

      const guardTrimmed = guardRaw.trim();
      const guardPid = Number.parseInt(guardTrimmed, 10);
      const hasValidGuardPid = Number.isInteger(guardPid) && guardPid > 0;

      if (hasValidGuardPid && guardPid === process.pid) {
        // We already established this generation guard in an earlier attempt of this takeover.
        rightHeld = true;
        break;
      }

      if (hasValidGuardPid && isProcessAlive(guardPid)) {
        guardContention = true;
        break;
      }

      const isInvalidAndFresh = !hasValidGuardPid && Date.now() - guardMtimeMs <= STALE_THRESHOLD_MS;
      if (isInvalidAndFresh) {
        guardContention = true;
        break;
      }
    }

    if (guardContention || !rightHeld) {
      const delayMs = 15 + Math.floor(Math.random() * 20);
      await sleep(delayMs);
      continue;
    }

    // Takeover invariant:
    // 1. Takeover rights are strictly keyed to a specific stale lock inode+mtimeNs instance.
    // 2. An exclusive right to remove that instance is granted to generation k if and only if
    //    all generations 0..k-1 exist with dead holders (or invalid content >3s old), and gen k
    //    is atomically created with `wx` (or already held by own pid). Guards are immutable and never unlinked for recovery.
    // 3. Generations scan upward without a fixed cap past dead generations until a `wx` create
    //    succeeds (right held) or a live/fresh holder is encountered (contention).
    // 4. Right-holder re-verifies inode+mtimeNs before unlinking the stale lock.
    // 5. Residual assumption: a dead holder PID is not recycled by the OS within the microsecond
    //    window before the next generation guard is established.
    const currentLock = await readLockState(lockPath, canonicalDir);
    if (
      currentLock &&
      currentLock.ino === lockState.ino &&
      currentLock.mtimeNs === lockState.mtimeNs &&
      !currentLock.isLiveOther &&
      !currentLock.isContention
    ) {
      await rm(lockPath, { force: true });
    }
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
