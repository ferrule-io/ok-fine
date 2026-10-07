import type { Readable } from "node:stream";
import type { BundleTree } from "./bundle.js";

export interface SyncStatus {
  remote: string | null;
  branch: string;
  lastSyncAt: string | null;
  lastError: string | null;
  ahead: number;
  behind: number;
}

export interface HistoryEntry {
  sha: string;
  at: string;
  actor: string;
  subject: string;
  principal: string | null;
}

export interface CommitSpec {
  subject: string;
  body?: string;
  author: string;
  principal: { subject: string; clientId: string };
}

export interface TransactionResult<T> {
  value: T;
  commit: string | null;
  pushed: boolean | null;
  warnings: string[];
}

/**
 * Content a backend accepted but could not reconcile with the authoritative copy. Backends never discard accepted
 * content: they keep it as one conflict per affected project until a client resolves it.
 */
export interface Conflict {
  /** Opaque, backend-assigned, unique within the project. */
  id: string;
  /** ISO 8601. */
  detectedAt: string;
  /** Changes to non-generated files (index.md files and the root log.md are omitted). */
  files: ConflictFile[];
  /** Writes the preserved side holds for this project, newest first. */
  writes: ConflictWrite[];
}

export interface ConflictWrite {
  /** ISO 8601. */
  at: string;
  actor: string;
  /** One-line description of the write. */
  subject: string;
}

export interface ConflictFile {
  /** Bundle-relative path. */
  path: string;
  /** What the preserved side did to the file, relative to the common base. */
  change: "added" | "modified" | "deleted";
  /** The current content also changed since the common base, so applying the preserved side needs a merge. */
  divergent: boolean;
}

/** `preserved`: the content the backend could not apply. `base`: the common ancestor of preserved and current. */
export type ConflictSide = "preserved" | "base";

/** Read-only view of one bundle. Paths are bundle-relative POSIX paths without dot segments. */
export interface BundleSource {
  readonly paths: readonly string[];
  read(path: string): Promise<Buffer | null>;
}

/** Mutations allowed only inside StorageBackend.transaction. Writes are visible to backend reads immediately. */
export interface StorageTx {
  writeFile(project: string, path: string, content: string | Buffer): Promise<void>;
  /** Also prunes now-empty parent dirs below the project root. */
  deleteFile(project: string, path: string): Promise<void>;
  deleteProject(project: string): Promise<void>;
  replaceProject(project: string, source: BundleSource): Promise<void>;
  /** Discards the conflict's preserved copy; takes effect only if the transaction completes without throwing. */
  resolveConflict(project: string, id: string): Promise<void>;
}

/**
 * Called with the backend lock held, once per project, whenever stored content may differ from what the service
 * last observed (external sync, rolled-back transaction). Must rebuild derived state; may write via tx.
 */
export type ResyncHandler = (project: string, tx: StorageTx) => Promise<void>;

export interface StorageBackend {
  /** Sorted; projects with at least one file. */
  projects(): Promise<string[]>;
  /** Immutable snapshot; BundleTree.EMPTY when absent. */
  tree(project: string): Promise<BundleTree>;
  /** null unless tree(project).hasFile(path). */
  readFile(project: string, path: string): Promise<Buffer | null>;
  transaction<T>(
    spec: { projects: string[] },
    work: (tx: StorageTx) => Promise<{ value: T; commit: CommitSpec | null }>,
  ): Promise<TransactionResult<T>>;
  setResyncHandler(handler: ResyncHandler): void;
  history(project: string, path: string | null, limit: number): Promise<HistoryEntry[]>;
  archive(project: string): Readable;
  sync(): Promise<SyncStatus>;
  syncStatus(): Promise<SyncStatus>;
  /** Unresolved conflicts touching `project`, oldest first. Never locks. */
  conflicts(project: string): Promise<Conflict[]>;
  /** One side of a conflicting file; null when the conflict is unknown or the file is absent on that side. */
  readConflictFile(project: string, id: string, side: ConflictSide, path: string): Promise<Buffer | null>;
  /** Waits for in-flight transactions. */
  close(): Promise<void>;
}

export function bundleSource(storage: StorageBackend, project: string, tree: BundleTree): BundleSource {
  return { paths: tree.paths, read: (path) => storage.readFile(project, path) };
}
