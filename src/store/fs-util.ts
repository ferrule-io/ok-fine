import { randomBytes } from "node:crypto";
import { access, mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { BundleSource } from "./backend.js";

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

/**
 * Lists regular files below `rootDir` as sorted POSIX relative paths. Skips dot-entries; symlinks and other
 * non-regular entries are excluded and never followed. A missing root yields [].
 */
export async function listTreeFiles(rootDir: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(rel: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(rel === "" ? rootDir : join(rootDir, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) {
        continue;
      }
      const childRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        await walk(childRel);
      } else if (entry.isFile()) {
        files.push(childRel);
      }
    }
  }
  await walk("");
  return files.sort();
}

export async function fsBundleSource(rootDir: string): Promise<BundleSource> {
  return {
    paths: await listTreeFiles(rootDir),
    read: (path) => readFile(join(rootDir, path)).catch(() => null),
  };
}
