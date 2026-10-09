import { performance } from "node:perf_hooks";
import { finished, Readable } from "node:stream";
import { OkfError } from "../errors.js";
import type { KnowledgeService } from "../service/knowledge-service.js";
import type {
  BundleSource,
  CommitSpec,
  Conflict,
  ConflictSide,
  HistoryEntry,
  ResyncHandler,
  StorageBackend,
  StorageTx,
  SyncStatus,
  TransactionResult,
} from "../store/backend.js";
import type { BundleTree } from "../store/bundle.js";
import type { MetricsLayer } from "./types.js";

export type Outcome = "ok" | "client_error" | "server_error";

/** The service reports client errors only as OkfError with a 4xx status; anything else is a server error. */
export function outcomeOf(err: unknown): Outcome {
  return err instanceof OkfError && err.status < 500 ? "client_error" : "server_error";
}

export interface MetricsSink {
  /** `startedAt` comes from `performance.now()`. */
  record(layer: MetricsLayer, op: string, startedAt: number, outcome: Outcome): void;
}

async function time<T>(sink: MetricsSink, layer: MetricsLayer, op: string, fn: () => Promise<T>): Promise<T> {
  const startedAt = performance.now();
  try {
    const value = await fn();
    sink.record(layer, op, startedAt, "ok");
    return value;
  } catch (err) {
    sink.record(layer, op, startedAt, outcomeOf(err));
    throw err;
  }
}

/** Records once the stream ends, errors, or is destroyed. */
function timeStream(sink: MetricsSink, layer: MetricsLayer, op: string, startedAt: number, stream: Readable): Readable {
  finished(stream, (err) => sink.record(layer, op, startedAt, err ? outcomeOf(err) : "ok"));
  return stream;
}

class InstrumentedTx implements StorageTx {
  constructor(
    private readonly inner: StorageTx,
    private readonly sink: MetricsSink,
  ) {}

  writeFile(project: string, path: string, content: string | Buffer): Promise<void> {
    return time(this.sink, "storage", "tx.writeFile", () => this.inner.writeFile(project, path, content));
  }

  deleteFile(project: string, path: string): Promise<void> {
    return time(this.sink, "storage", "tx.deleteFile", () => this.inner.deleteFile(project, path));
  }

  deleteProject(project: string): Promise<void> {
    return time(this.sink, "storage", "tx.deleteProject", () => this.inner.deleteProject(project));
  }

  replaceProject(project: string, source: BundleSource): Promise<void> {
    return time(this.sink, "storage", "tx.replaceProject", () => this.inner.replaceProject(project, source));
  }

  resolveConflict(project: string, id: string): Promise<void> {
    return time(this.sink, "storage", "tx.resolveConflict", () => this.inner.resolveConflict(project, id));
  }
}

/** Times every StorageBackend and StorageTx call under layer `storage`, op = method name. */
export class InstrumentedStorage implements StorageBackend {
  constructor(
    private readonly inner: StorageBackend,
    private readonly sink: MetricsSink,
  ) {}

  projects(): Promise<string[]> {
    return time(this.sink, "storage", "projects", () => this.inner.projects());
  }

  tree(project: string): Promise<BundleTree> {
    return time(this.sink, "storage", "tree", () => this.inner.tree(project));
  }

  readFile(project: string, path: string): Promise<Buffer | null> {
    return time(this.sink, "storage", "readFile", () => this.inner.readFile(project, path));
  }

  /** Duration includes lock wait, the work, commit, and push. */
  transaction<T>(
    spec: { projects: string[] },
    work: (tx: StorageTx) => Promise<{ value: T; commit: CommitSpec | null }>,
  ): Promise<TransactionResult<T>> {
    return time(this.sink, "storage", "transaction", () =>
      this.inner.transaction(spec, (tx) => work(new InstrumentedTx(tx, this.sink))),
    );
  }

  setResyncHandler(handler: ResyncHandler): void {
    this.inner.setResyncHandler((project, tx) => handler(project, new InstrumentedTx(tx, this.sink)));
  }

  history(project: string, path: string | null, limit: number): Promise<HistoryEntry[]> {
    return time(this.sink, "storage", "history", () => this.inner.history(project, path, limit));
  }

  archive(project: string): Readable {
    const startedAt = performance.now();
    let stream: Readable;
    try {
      stream = this.inner.archive(project);
    } catch (err) {
      this.sink.record("storage", "archive", startedAt, outcomeOf(err));
      throw err;
    }
    return timeStream(this.sink, "storage", "archive", startedAt, stream);
  }

  sync(): Promise<SyncStatus> {
    return time(this.sink, "storage", "sync", () => this.inner.sync());
  }

  syncStatus(): Promise<SyncStatus> {
    return time(this.sink, "storage", "syncStatus", () => this.inner.syncStatus());
  }

  conflicts(project: string): Promise<Conflict[]> {
    return time(this.sink, "storage", "conflicts", () => this.inner.conflicts(project));
  }

  readConflictFile(project: string, id: string, side: ConflictSide, path: string): Promise<Buffer | null> {
    return time(this.sink, "storage", "readConflictFile", () => this.inner.readConflictFile(project, id, side, path));
  }

  close(): Promise<void> {
    return this.inner.close();
  }
}

/**
 * Times every KnowledgeService method call under layer `service`, op = method name. A Proxy covers methods added
 * later; methods run bound to the raw service, so its internal `this.*` calls are not counted twice.
 */
export function instrumentService(service: KnowledgeService, sink: MetricsSink): KnowledgeService {
  const wrappers = new Map<string, (...args: unknown[]) => unknown>();
  return new Proxy(service, {
    get(target, prop) {
      const value: unknown = Reflect.get(target, prop);
      if (typeof prop !== "string" || prop === "constructor" || typeof value !== "function") return value;
      let wrapper = wrappers.get(prop);
      if (!wrapper) {
        wrapper = (...args: unknown[]): unknown => {
          const startedAt = performance.now();
          let result: unknown;
          try {
            result = Reflect.apply(value, target, args);
          } catch (err) {
            sink.record("service", prop, startedAt, outcomeOf(err));
            throw err;
          }
          if (result instanceof Promise) {
            return result.then(
              (v: unknown) => {
                sink.record("service", prop, startedAt, "ok");
                return v;
              },
              (err: unknown) => {
                sink.record("service", prop, startedAt, outcomeOf(err));
                throw err;
              },
            );
          }
          if (result instanceof Readable) return timeStream(sink, "service", prop, startedAt, result);
          sink.record("service", prop, startedAt, "ok");
          return result;
        };
        wrappers.set(prop, wrapper);
      }
      return wrapper;
    },
  });
}
