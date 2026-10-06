import { readFileSync, unlinkSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

function errorCode(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | null)?.code;
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return errorCode(err) === "EPERM";
  }
}

/**
 * Takes the exclusive per-data-dir lock for a local CLI process; a lock left by a dead process is taken over.
 * Returns a synchronous release, safe to call from `process.on("exit")`.
 */
export async function lockDataDir(dataDir: string): Promise<() => void> {
  await mkdir(dataDir, { recursive: true });
  const lockPath = join(dataDir, "ok-fine.lock");
  const pid = String(process.pid);

  let holder = "unknown";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await writeFile(lockPath, `${pid}\n`, { flag: "wx" });
      return () => {
        try {
          if (readFileSync(lockPath, "utf8").trim() === pid) unlinkSync(lockPath);
        } catch (err) {
          if (errorCode(err) !== "ENOENT") throw err;
        }
      };
    } catch (err) {
      if (errorCode(err) !== "EEXIST") throw err;
    }

    let content: string;
    try {
      content = (await readFile(lockPath, "utf8")).trim();
    } catch (err) {
      if (errorCode(err) === "ENOENT") continue;
      throw err;
    }
    holder = content || "unknown";
    const holderPid = Number.parseInt(content, 10);
    if (Number.isInteger(holderPid) && holderPid > 0 && holderPid !== process.pid && isRunning(holderPid)) break;
    await rm(lockPath, { force: true });
  }
  throw new Error(
    `ok-fine is already running on ${dataDir} (pid ${holder}). One process serves a data directory: connect more clients to \`ok-fine serve\` over HTTP, or pass a different --data-dir. If no ok-fine process is running, delete ${lockPath}.`,
  );
}
