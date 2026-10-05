import { readFile, readdir, rm, rmdir } from "node:fs/promises";
import { join, posix } from "node:path";
import { type DirListing, renderIndex } from "../okf/index-file.js";
import { type LintIssue, lintConceptFile, lintIndexFile, lintLogFile } from "../okf/lint.js";
import { isReservedName } from "../okf/paths.js";
import { parseConcept, type ConceptRecord } from "../okf/concept.js";
import { displayTitle } from "../okf/semantics.js";
import { atomicWrite, isDirectory, pathExists } from "./fs-util.js";

export interface BundleWalk {
  conceptFiles: string[];
  otherFiles: string[];
  dirs: string[];
}

export async function walkBundle(projectDir: string): Promise<BundleWalk> {
  const conceptFiles: string[] = [];
  const otherFiles: string[] = [];
  const dirs: string[] = [];

  async function walk(currentRel: string): Promise<void> {
    const currentAbs = currentRel === "" ? projectDir : join(projectDir, currentRel);
    let entries: string[];
    try {
      entries = await readdir(currentAbs);
    } catch {
      return;
    }

    for (const name of entries) {
      if (name.startsWith(".")) {
        continue;
      }
      const relPath = currentRel === "" ? name : posix.join(currentRel, name);
      const absPath = join(projectDir, relPath);

      if (await isDirectory(absPath)) {
        dirs.push(relPath);
        await walk(relPath);
      } else {
        if (isReservedName(name)) {
          continue;
        }
        if (name.toLowerCase().endsWith(".md")) {
          conceptFiles.push(relPath);
        } else {
          otherFiles.push(relPath);
        }
      }
    }
  }

  await walk("");
  return { conceptFiles, otherFiles, dirs };
}

export async function buildDirListing(
  projectDir: string,
  relDir: string,
  catalogLookup: (id: string) => ConceptRecord | undefined
): Promise<DirListing> {
  const normRelDir = relDir === "." || relDir === "/" ? "" : relDir.replace(/^\/+|\/+$/g, "");
  const isRoot = normRelDir === "";
  const dirAbs = isRoot ? projectDir : join(projectDir, normRelDir);

  let entries: string[] = [];
  try {
    entries = await readdir(dirAbs);
  } catch {
    // Return empty listing if directory cannot be read
  }

  const concepts: DirListing["concepts"] = [];
  const files: string[] = [];
  const dirs: DirListing["dirs"] = [];

  for (const name of entries) {
    if (name.startsWith(".")) {
      continue;
    }
    const itemRel = isRoot ? name : posix.join(normRelDir, name);
    const itemAbs = join(projectDir, itemRel);

    if (await isDirectory(itemAbs)) {
      // Compute recursive concept and file counts
      const subWalk = await walkBundle(itemAbs);
      dirs.push({
        name,
        conceptCount: subWalk.conceptFiles.length,
        fileCount: subWalk.otherFiles.length,
      });
    } else {
      if (isReservedName(name)) {
        continue;
      }
      if (name.toLowerCase().endsWith(".md")) {
        const conceptId = itemRel.slice(0, -3);
        const record = catalogLookup(conceptId);
        concepts.push({
          file: name,
          title: record?.title ?? displayTitle(null, conceptId),
          description: record?.description ?? null,
          type: record?.type ?? null,
        });
      } else {
        files.push(name);
      }
    }
  }

  return { isRoot, concepts, files, dirs };
}

export async function regenerateIndexes(
  projectDir: string,
  dirs: string[] | "all",
  lookup: (id: string) => ConceptRecord | undefined
): Promise<string[]> {
  const changedPaths: string[] = [];

  let targetDirs: Set<string>;
  if (dirs === "all") {
    const walk = await walkBundle(projectDir);
    targetDirs = new Set(["", ...walk.dirs]);
  } else {
    targetDirs = new Set<string>();
    for (const d of dirs) {
      let current = d === "." || d === "/" ? "" : d.replace(/^\/+|\/+$/g, "");
      while (true) {
        targetDirs.add(current);
        if (current === "") {
          break;
        }
        const parent = posix.dirname(current);
        current = parent === "." ? "" : parent;
      }
    }
    targetDirs.add("");
  }

  // Process deepest directories first
  const sorted = Array.from(targetDirs).sort((a, b) => {
    const depthA = a === "" ? 0 : a.split("/").length;
    const depthB = b === "" ? 0 : b.split("/").length;
    if (depthB !== depthA) {
      return depthB - depthA;
    }
    return b.localeCompare(a);
  });

  for (const dir of sorted) {
    const dirAbs = dir === "" ? projectDir : join(projectDir, dir);
    if (!(await pathExists(dirAbs))) {
      continue;
    }

    const indexPath = join(dirAbs, "index.md");
    const relIndexPath = dir === "" ? "index.md" : posix.join(dir, "index.md");

    // Check if directory has any non-reserved files recursively
    const walk = await walkBundle(dirAbs);
    const hasFiles = walk.conceptFiles.length > 0 || walk.otherFiles.length > 0;

    if (!hasFiles && dir !== "") {
      if (await pathExists(indexPath)) {
        await rm(indexPath, { force: true });
        changedPaths.push(relIndexPath);
      }
      // Prune directory if completely empty
      try {
        const remaining = await readdir(dirAbs);
        if (remaining.length === 0) {
          await rmdir(dirAbs);
        }
      } catch {
        // ignore rmdir errors
      }
      continue;
    }

    const listing = await buildDirListing(projectDir, dir, lookup);
    const rendered = renderIndex(listing);

    let existingContent: string | null = null;
    try {
      existingContent = await readFile(indexPath, "utf8");
    } catch {
      // index.md does not exist yet
    }

    if (existingContent !== rendered) {
      await atomicWrite(indexPath, rendered);
      changedPaths.push(relIndexPath);
    }
  }

  return changedPaths;
}

export async function lintBundle(
  bundleDir: string,
  now: Date
): Promise<{ conformant: boolean; issues: LintIssue[] }> {
  const issues: LintIssue[] = [];

  const walk = await walkBundle(bundleDir);
  const conceptIdSet = new Set(walk.conceptFiles.map((f) => f.slice(0, -3)));
  const allBundleFiles = new Set<string>([...walk.conceptFiles, ...walk.otherFiles]);

  const ctx = {
    now,
    conceptExists: (id: string) => conceptIdSet.has(id),
    fileExists: (relPath: string) => allBundleFiles.has(relPath),
  };

  // Lint concepts
  for (const cFile of walk.conceptFiles) {
    const absPath = join(bundleDir, cFile);
    try {
      const text = await readFile(absPath, "utf8");
      const cIssues = lintConceptFile(cFile, text, ctx);
      issues.push(...cIssues);
    } catch {
      // ignore read error
    }
  }

  // Lint index.md files
  const rootIndexAbs = join(bundleDir, "index.md");
  if (await pathExists(rootIndexAbs)) {
    try {
      const text = await readFile(rootIndexAbs, "utf8");
      issues.push(...lintIndexFile("index.md", text, true));
    } catch {
      // ignore
    }
  } else {
    issues.push({
      severity: "info",
      code: "missing_root_index",
      path: "index.md",
      message: "bundle is missing root index.md",
    });
  }

  for (const d of walk.dirs) {
    const subIndexAbs = join(bundleDir, d, "index.md");
    if (await pathExists(subIndexAbs)) {
      try {
        const text = await readFile(subIndexAbs, "utf8");
        issues.push(...lintIndexFile(posix.join(d, "index.md"), text, false));
      } catch {
        // ignore
      }
    }
  }

  // Lint log.md files
  const rootLogAbs = join(bundleDir, "log.md");
  if (await pathExists(rootLogAbs)) {
    try {
      const text = await readFile(rootLogAbs, "utf8");
      issues.push(...lintLogFile("log.md", text));
    } catch {
      // ignore
    }
  }

  const conformant = !issues.some((i) => i.severity === "error");
  return { conformant, issues };
}
