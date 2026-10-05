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
  /** Waits for in-flight transactions. */
  close(): Promise<void>;
}

export function bundleSource(storage: StorageBackend, project: string, tree: BundleTree): BundleSource {
  return { paths: tree.paths, read: (path) => storage.readFile(project, path) };
}
