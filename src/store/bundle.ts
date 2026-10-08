import { posix } from "node:path";
import type { ConceptRecord } from "../okf/concept.js";
import { type DirListing, renderIndex } from "../okf/index-file.js";
import { type LintIssue, lintConceptFile, lintIndexFile, lintLogFile } from "../okf/lint.js";
import { isReservedName } from "../okf/paths.js";
import { displayTitle } from "../okf/semantics.js";
import type { BundleSource } from "./backend.js";

/** True for non-reserved `.md` files, i.e. files that hold a concept. */
export function isConceptPath(path: string): boolean {
  const name = posix.basename(path);
  return !isReservedName(name) && name.toLowerCase().endsWith(".md");
}

interface DirEntries {
  files: string[];
  dirs: string[];
}

interface DirCounts {
  conceptCount: number;
  fileCount: number;
}

const NO_ENTRIES: DirEntries = Object.freeze({ files: [], dirs: [] }) as DirEntries;
const NO_COUNTS: DirCounts = Object.freeze({ conceptCount: 0, fileCount: 0 });

function parentDir(path: string): string {
  const parent = posix.dirname(path);
  return parent === "." ? "" : parent;
}

function normalizeDir(dir: string): string {
  return dir === "." || dir === "/" ? "" : dir.replace(/^\/+|\/+$/g, "");
}

/** Immutable file/directory model of one bundle, built from its file paths (including index.md/log.md). */
export class BundleTree {
  static readonly EMPTY = new BundleTree([]);

  readonly paths: readonly string[];
  readonly conceptFiles: readonly string[];
  readonly otherFiles: readonly string[];
  readonly dirs: readonly string[];

  private readonly fileSet: ReadonlySet<string>;
  private readonly dirSet: ReadonlySet<string>;
  private readonly dirEntries = new Map<string, DirEntries>();
  private readonly dirCounts = new Map<string, DirCounts>();

  constructor(paths: Iterable<string>) {
    const sorted = Array.from(new Set(paths)).sort();
    const conceptFiles: string[] = [];
    const otherFiles: string[] = [];
    const dirSet = new Set<string>();

    for (const path of sorted) {
      const name = posix.basename(path);
      const reserved = isReservedName(name);
      const isConcept = !reserved && name.toLowerCase().endsWith(".md");
      if (isConcept) {
        conceptFiles.push(path);
      } else if (!reserved) {
        otherFiles.push(path);
      }

      let dir = parentDir(path);
      this.entriesFor(dir).files.push(name);
      while (true) {
        if (!reserved) {
          const counts = this.dirCounts.get(dir) ?? { conceptCount: 0, fileCount: 0 };
          if (isConcept) {
            counts.conceptCount++;
          } else {
            counts.fileCount++;
          }
          this.dirCounts.set(dir, counts);
        }
        if (dir === "") {
          break;
        }
        if (!dirSet.has(dir)) {
          // First sighting: register dir as a child of its parent.
          dirSet.add(dir);
          this.entriesFor(parentDir(dir)).dirs.push(posix.basename(dir));
        }
        dir = parentDir(dir);
      }
    }

    this.paths = sorted;
    this.conceptFiles = conceptFiles;
    this.otherFiles = otherFiles;
    this.fileSet = new Set(sorted);
    this.dirSet = dirSet;
    this.dirs = Array.from(dirSet).sort();
  }

  private entriesFor(dir: string): DirEntries {
    let entries = this.dirEntries.get(dir);
    if (!entries) {
      entries = { files: [], dirs: [] };
      this.dirEntries.set(dir, entries);
    }
    return entries;
  }

  get isEmpty(): boolean {
    return this.paths.length === 0;
  }

  hasFile(path: string): boolean {
    return this.fileSet.has(path);
  }

  hasDir(dir: string): boolean {
    return dir === "" ? !this.isEmpty : this.dirSet.has(dir);
  }

  /** Direct-child basenames of `dir` ("" = root). */
  entries(dir: string): { readonly files: readonly string[]; readonly dirs: readonly string[] } {
    return this.dirEntries.get(dir) ?? NO_ENTRIES;
  }

  /** Recursive counts of non-reserved files below `dir`. */
  counts(dir: string): Readonly<DirCounts> {
    return this.dirCounts.get(dir) ?? NO_COUNTS;
  }

  /** True for an existing file or directory addressed by a bundle path that stays inside the bundle. */
  exists(bundlePath: string): boolean {
    let normalized = posix.normalize(bundlePath.replace(/^\/+/, ""));
    if (normalized === ".." || normalized.startsWith("../")) return false;
    if (normalized === "." || normalized === "./") return !this.isEmpty;
    normalized = normalized.replace(/\/+$/, "");
    return this.fileSet.has(normalized) || this.dirSet.has(normalized);
  }
}

export function buildDirListing(
  tree: BundleTree,
  relDir: string,
  catalogLookup: (id: string) => ConceptRecord | undefined,
): DirListing {
  const normRelDir = normalizeDir(relDir);
  const isRoot = normRelDir === "";
  const entries = tree.entries(normRelDir);

  const concepts: DirListing["concepts"] = [];
  const files: string[] = [];
  const dirs: DirListing["dirs"] = [];

  for (const name of entries.files) {
    if (isReservedName(name)) {
      continue;
    }
    const itemRel = isRoot ? name : posix.join(normRelDir, name);
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

  for (const name of entries.dirs) {
    const counts = tree.counts(isRoot ? name : posix.join(normRelDir, name));
    // Dirs without non-reserved files are pruned by index regeneration, so they are never listed.
    if (counts.conceptCount + counts.fileCount === 0) {
      continue;
    }
    dirs.push({ name, conceptCount: counts.conceptCount, fileCount: counts.fileCount });
  }

  return { isRoot, concepts, files, dirs };
}

/**
 * Plans index.md changes for `dirs` (plus their ancestors) or every dir. `content: null` means delete.
 * Ordered deepest-first so a child's deletion (which prunes its dir) precedes its parent.
 */
export function planIndexes(
  tree: BundleTree,
  dirs: string[] | "all",
  lookup: (id: string) => ConceptRecord | undefined,
): Array<{ path: string; content: string | null }> {
  if (tree.isEmpty) {
    return [];
  }

  let targetDirs: Set<string>;
  if (dirs === "all") {
    targetDirs = new Set(["", ...tree.dirs]);
  } else {
    targetDirs = new Set<string>([""]);
    for (const d of dirs) {
      let current = normalizeDir(d);
      while (current !== "") {
        targetDirs.add(current);
        current = parentDir(current);
      }
    }
  }

  const sorted = Array.from(targetDirs).sort((a, b) => {
    const depthA = a === "" ? 0 : a.split("/").length;
    const depthB = b === "" ? 0 : b.split("/").length;
    if (depthB !== depthA) {
      return depthB - depthA;
    }
    return b.localeCompare(a);
  });

  const plan: Array<{ path: string; content: string | null }> = [];
  for (const dir of sorted) {
    const indexPath = dir === "" ? "index.md" : `${dir}/index.md`;
    if (dir !== "") {
      if (!tree.hasDir(dir)) {
        continue;
      }
      const counts = tree.counts(dir);
      if (counts.conceptCount + counts.fileCount === 0) {
        if (tree.hasFile(indexPath)) {
          plan.push({ path: indexPath, content: null });
        }
        continue;
      }
    }
    plan.push({ path: indexPath, content: renderIndex(buildDirListing(tree, dir, lookup)) });
  }
  return plan;
}

export async function lintBundle(
  source: BundleSource,
  now: Date,
  options?: {
    crossProjectConceptExists?: (project: string, id: string) => boolean;
  },
): Promise<{ conformant: boolean; issues: LintIssue[] }> {
  const issues: LintIssue[] = [];
  const tree = new BundleTree(source.paths);
  const conceptIdSet = new Set(tree.conceptFiles.map((f) => f.slice(0, -3)));
  const allBundleFiles = new Set<string>([...tree.conceptFiles, ...tree.otherFiles]);

  const ctx = {
    now,
    conceptExists: (id: string) => conceptIdSet.has(id),
    fileExists: (relPath: string) => allBundleFiles.has(relPath),
    crossProjectConceptExists: options?.crossProjectConceptExists,
  };

  const readText = async (path: string): Promise<string | null> => {
    const buf = await source.read(path);
    return buf === null ? null : buf.toString("utf8");
  };

  for (const cFile of tree.conceptFiles) {
    const text = await readText(cFile);
    if (text !== null) {
      issues.push(...lintConceptFile(cFile, text, ctx));
    }
  }

  if (tree.hasFile("index.md")) {
    const text = await readText("index.md");
    if (text !== null) {
      issues.push(...lintIndexFile("index.md", text, true));
    }
  } else {
    issues.push({
      severity: "info",
      code: "missing_root_index",
      path: "index.md",
      message: "bundle is missing root index.md",
    });
  }

  for (const d of tree.dirs) {
    const subIndex = `${d}/index.md`;
    if (tree.hasFile(subIndex)) {
      const text = await readText(subIndex);
      if (text !== null) {
        issues.push(...lintIndexFile(subIndex, text, false));
      }
    }
  }

  if (tree.hasFile("log.md")) {
    const text = await readText("log.md");
    if (text !== null) {
      issues.push(...lintLogFile("log.md", text));
    }
  }

  const conformant = !issues.some((i) => i.severity === "error");
  return { conformant, issues };
}
