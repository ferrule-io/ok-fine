import { randomBytes } from "node:crypto";
import { access, mkdir, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export async function atomicWrite(absPath: string, data: string | Buffer): Promise<void> {
  const dir = dirname(absPath);
  await mkdir(dir, { recursive: true });
  const tmpName = join(dir, `.${basename(absPath)}.${randomBytes(4).toString("hex")}.tmp`);
  await writeFile(tmpName, data);
  await rename(tmpName, absPath);
}

export async function pathExists(absPath: string): Promise<boolean> {
  try {
    await access(absPath);
    return true;
  } catch {
    return false;
  }
}

export async function isDirectory(absPath: string): Promise<boolean> {
  try {
    const s = await stat(absPath);
    return s.isDirectory();
  } catch {
    return false;
  }
}
