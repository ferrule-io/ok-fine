import { randomBytes } from "node:crypto";
import type { Dirent } from "node:fs";
import { access, lstat, mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join, posix } from "node:path";
import { OkfError } from "../errors.js";
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
    const s = await lstat(absPath);
    return s.isDirectory() && !s.isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Lists regular files below `rootDir` as sorted POSIX relative paths. Skips dot-entries; symlinks and other
 * non-regular entries are excluded and never followed. A missing root yields [].
 */
export async function listTreeFiles(rootDir: string): Promise<string[]> {
  try {
    const s = await lstat(rootDir);
    if (s.isSymbolicLink() || !s.isDirectory()) {
      return [];
    }
  } catch {
    return [];
  }
  const files: string[] = [];
  async function walk(rel: string): Promise<void> {
    let entries: Dirent[];
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

export async function assertContainedPath(repoDir: string, project: string, relPath?: string): Promise<void> {
  const projectDir = join(repoDir, project);
  try {
    const s = await lstat(projectDir);
    if (s.isSymbolicLink()) {
      throw new OkfError("invalid_path", 400, `project directory "${project}" is a symbolic link`);
    }
    if (!s.isDirectory()) {
      throw new OkfError("invalid_path", 400, `project directory "${project}" is not a directory`);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw err;
  }

  if (!relPath) {
    return;
  }

  const parentDir = posix.dirname(relPath);
  if (parentDir === "." || parentDir === "") {
    return;
  }

  const segments = parentDir.split("/").filter((s) => s.length > 0);
  let current = projectDir;
  for (const segment of segments) {
    current = join(current, segment);
    try {
      const s = await lstat(current);
      if (s.isSymbolicLink()) {
        throw new OkfError("invalid_path", 400, `path component "${segment}" is a symbolic link`);
      }
      if (!s.isDirectory()) {
        throw new OkfError("invalid_path", 400, `path component "${segment}" is not a directory`);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        break;
      }
      throw err;
    }
  }
}
