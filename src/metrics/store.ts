import { rmSync } from "node:fs";
import { performance } from "node:perf_hooks";
import type { DatabaseSync, SQLOutputValue, StatementSync } from "node:sqlite";
import type { Logger } from "../config.js";
import { BUCKET_COUNT, bucketIndex, quantile } from "./histogram.js";
import type { MetricsSink, Outcome } from "./instrument.js";
import {
  type LayerMetrics,
  METRICS_LAYERS,
  type MetricsLayer,
  type MetricsPoint,
  type MetricsReport,
  type MetricsStats,
  type MetricsWindow,
  type OperationMetrics,
} from "./types.js";

export const METRICS_DB_FILE = "metrics.sqlite";

/** Bump when the tables or LATENCY_BUCKETS_MS change; a mismatching database is rebuilt (metrics are disposable). */
const SCHEMA_VERSION = 1;
const FLUSH_INTERVAL_MS = 10_000;
const MINUTE_RETENTION_SECONDS = 172_800;
const PRUNE_INTERVAL_SECONDS = 3_600;

const WINDOWS: Record<MetricsWindow, { seconds: number; table: Table; stepSeconds: number }> = {
  "1h": { seconds: 3_600, table: "metrics_minute", stepSeconds: 60 },
  "24h": { seconds: 86_400, table: "metrics_minute", stepSeconds: 900 },
  "7d": { seconds: 604_800, table: "metrics_hour", stepSeconds: 7_200 },
  "30d": { seconds: 2_592_000, table: "metrics_hour", stepSeconds: 21_600 },
};

type Table = "metrics_minute" | "metrics_hour";
const TABLES: readonly Table[] = ["metrics_minute", "metrics_hour"];

const BUCKET_COLUMNS = Array.from({ length: BUCKET_COUNT }, (_, i) => `b${String(i).padStart(2, "0")}`);
const VALUE_COLUMNS = ["count", "client_errors", "server_errors", "sum_ms", "min_ms", "max_ms", ...BUCKET_COLUMNS];
const SUMS = [
  "SUM(count) AS count",
  "SUM(client_errors) AS client_errors",
  "SUM(server_errors) AS server_errors",
  "SUM(sum_ms) AS sum_ms",
  "MIN(min_ms) AS min_ms",
  "MAX(max_ms) AS max_ms",
  ...BUCKET_COLUMNS.map((c) => `SUM(${c}) AS ${c}`),
].join(", ");

interface Totals {
  count: number;
  clientErrors: number;
  serverErrors: number;
  sumMs: number;
  minMs: number;
  maxMs: number;
  buckets: number[];
}

interface Pending extends Totals {
  minuteStart: number;
  layer: MetricsLayer;
  op: string;
}

interface Statements {
  upsert: Record<Table, StatementSync>;
  prune: Record<Table, StatementSync>;
  operations: Record<Table, StatementSync>;
  series: Record<Table, StatementSync>;
}

type Row = Record<string, SQLOutputValue>;

export interface MetricsStoreOptions {
  path: string;
  retentionDays: number;
  log: Logger;
  /** Epoch ms; defaults to Date.now. */
  now?: () => number;
}

function createSchema(db: DatabaseSync): void {
  const columns = [
    "bucket_start INTEGER NOT NULL",
    "layer TEXT NOT NULL",
    "op TEXT NOT NULL",
    "count INTEGER NOT NULL",
    "client_errors INTEGER NOT NULL",
    "server_errors INTEGER NOT NULL",
    "sum_ms REAL NOT NULL",
    "min_ms REAL NOT NULL",
    "max_ms REAL NOT NULL",
    ...BUCKET_COLUMNS.map((c) => `${c} INTEGER NOT NULL`),
    "PRIMARY KEY (bucket_start, layer, op)",
  ].join(", ");
  for (const table of TABLES) {
    db.exec(`DROP TABLE IF EXISTS ${table}`);
    db.exec(`CREATE TABLE ${table} (${columns}) WITHOUT ROWID`);
  }
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}

function prepare(db: DatabaseSync): Statements {
  const perTable = (sql: (table: Table) => string): Record<Table, StatementSync> => ({
    metrics_minute: db.prepare(sql("metrics_minute")),
    metrics_hour: db.prepare(sql("metrics_hour")),
  });
  const insertColumns = ["bucket_start", "layer", "op", ...VALUE_COLUMNS];
  const updates = VALUE_COLUMNS.map((c) =>
    c === "min_ms" || c === "max_ms" ? `${c} = ${c.slice(0, 3)}(${c}, excluded.${c})` : `${c} = ${c} + excluded.${c}`,
  ).join(", ");
  return {
    upsert: perTable(
      (t) =>
        `INSERT INTO ${t} (${insertColumns.join(", ")}) VALUES (${insertColumns.map(() => "?").join(", ")}) ` +
        `ON CONFLICT (bucket_start, layer, op) DO UPDATE SET ${updates}`,
    ),
    prune: perTable((t) => `DELETE FROM ${t} WHERE bucket_start < ?`),
    operations: perTable((t) => `SELECT layer, op, ${SUMS} FROM ${t} WHERE bucket_start >= ? GROUP BY layer, op`),
    // `bucket_start - (bucket_start % ?)`, not `/ ? * ?`: node:sqlite binds JS numbers as REAL, so `/` would not truncate.
    series: perTable(
      (t) =>
        `SELECT bucket_start - (bucket_start % ?) AS t, layer, ${SUMS} FROM ${t} WHERE bucket_start >= ? ` +
        "GROUP BY t, layer ORDER BY t, layer",
    ),
  };
}

function num(row: Row, key: string): number {
  const v = row[key];
  return typeof v === "number" ? v : typeof v === "bigint" ? Number(v) : 0;
}

function str(row: Row, key: string): string {
  const v = row[key];
  return typeof v === "string" ? v : "";
}

function totalsOf(row: Row): Totals {
  return {
    count: num(row, "count"),
    clientErrors: num(row, "client_errors"),
    serverErrors: num(row, "server_errors"),
    sumMs: num(row, "sum_ms"),
    minMs: num(row, "min_ms"),
    maxMs: num(row, "max_ms"),
    buckets: BUCKET_COLUMNS.map((c) => num(row, c)),
  };
}

function merge(into: Totals, from: Totals): void {
  into.count += from.count;
  into.clientErrors += from.clientErrors;
  into.serverErrors += from.serverErrors;
  into.sumMs += from.sumMs;
  into.minMs = Math.min(into.minMs, from.minMs);
  into.maxMs = Math.max(into.maxMs, from.maxMs);
  for (let i = 0; i < BUCKET_COUNT; i++) into.buckets[i] = (into.buckets[i] ?? 0) + (from.buckets[i] ?? 0);
}

const round3 = (ms: number): number => Math.round(ms * 1000) / 1000;

function statsOf(t: Totals): MetricsStats {
  return {
    count: t.count,
    clientErrors: t.clientErrors,
    serverErrors: t.serverErrors,
    avgMs: round3(t.count === 0 ? 0 : t.sumMs / t.count),
    maxMs: round3(t.maxMs),
    p50Ms: round3(quantile(t.buckets, 0.5, t.minMs, t.maxMs)),
    p95Ms: round3(quantile(t.buckets, 0.95, t.minMs, t.maxMs)),
    p99Ms: round3(quantile(t.buckets, 0.99, t.minMs, t.maxMs)),
  };
}

const iso = (sec: number): string => new Date(sec * 1000).toISOString();

/**
 * Per-minute call aggregates (count, errors, latency histogram) in SQLite under DATA_DIR, rolled up hourly.
 * Observations buffer in memory and flush every FLUSH_INTERVAL_MS; a crash loses at most one interval.
 */
export class MetricsStore implements MetricsSink {
  private pending = new Map<string, Pending>();
  private lastPruneSec: number;
  private closed = false;
  private readonly timer: NodeJS.Timeout;

  private constructor(
    private readonly db: DatabaseSync,
    private readonly statements: Statements,
    private readonly retentionDays: number,
    private readonly log: Logger,
    private readonly now: () => number,
  ) {
    this.lastPruneSec = Math.floor(now() / 1000);
    this.prune(this.lastPruneSec);
    this.timer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);
    this.timer.unref();
  }

  static async open(options: MetricsStoreOptions): Promise<MetricsStore> {
    // Loaded lazily: node:sqlite prints an ExperimentalWarning on load, so only processes that open storage pay it,
    // not every `ok-fine --help` or stdio-proxy start.
    const { DatabaseSync } = await import("node:sqlite");
    const connect = (): { db: DatabaseSync; statements: Statements } => {
      let db: DatabaseSync | undefined;
      try {
        db = new DatabaseSync(options.path);
        // A filesystem without WAL support keeps rollback journaling; the result is ignored.
        db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 1000");
        const version = db.prepare("PRAGMA user_version").get();
        if (!version || num(version, "user_version") !== SCHEMA_VERSION) createSchema(db);
        return { db, statements: prepare(db) };
      } catch (err) {
        if (db?.isOpen) db.close();
        throw err;
      }
    };

    let opened: { db: DatabaseSync; statements: Statements };
    try {
      opened = connect();
    } catch (err) {
      options.log.warn({ err, path: options.path }, "metrics database unusable; recreating it");
      for (const suffix of ["", "-wal", "-shm"]) rmSync(`${options.path}${suffix}`, { force: true });
      opened = connect();
    }
    return new MetricsStore(opened.db, opened.statements, options.retentionDays, options.log, options.now ?? Date.now);
  }

  record(layer: MetricsLayer, op: string, startedAt: number, outcome: Outcome): void {
    this.observe(layer, op, performance.now() - startedAt, outcome);
  }

  observe(layer: MetricsLayer, op: string, durationMs: number, outcome: Outcome): void {
    if (this.closed) return;
    const minuteStart = Math.floor(this.now() / 60_000) * 60;
    const key = `${minuteStart}\u0000${layer}\u0000${op}`;
    let p = this.pending.get(key);
    if (!p) {
      p = {
        minuteStart,
        layer,
        op,
        count: 0,
        clientErrors: 0,
        serverErrors: 0,
        sumMs: 0,
        minMs: durationMs,
        maxMs: durationMs,
        buckets: new Array<number>(BUCKET_COUNT).fill(0),
      };
      this.pending.set(key, p);
    }
    p.count++;
    if (outcome === "client_error") p.clientErrors++;
    if (outcome === "server_error") p.serverErrors++;
    p.sumMs += durationMs;
    p.minMs = Math.min(p.minMs, durationMs);
    p.maxMs = Math.max(p.maxMs, durationMs);
    const i = bucketIndex(durationMs);
    p.buckets[i] = (p.buckets[i] ?? 0) + 1;
  }

  /** Writes buffered observations (and prunes when due) in one transaction. Never throws. */
  flush(): void {
    if (this.closed) return;
    const batch = this.pending;
    this.pending = new Map();
    const nowSec = Math.floor(this.now() / 1000);
    const pruneDue = nowSec - this.lastPruneSec >= PRUNE_INTERVAL_SECONDS;
    if (batch.size === 0 && !pruneDue) return;
    try {
      this.db.exec("BEGIN");
      for (const p of batch.values()) {
        const values = [
          p.layer,
          p.op,
          p.count,
          p.clientErrors,
          p.serverErrors,
          p.sumMs,
          p.minMs,
          p.maxMs,
          ...p.buckets,
        ];
        this.statements.upsert.metrics_minute.run(p.minuteStart, ...values);
        this.statements.upsert.metrics_hour.run(p.minuteStart - (p.minuteStart % 3600), ...values);
      }
      if (pruneDue) this.prune(nowSec);
      this.db.exec("COMMIT");
    } catch (err) {
      if (this.db.isTransaction) this.db.exec("ROLLBACK");
      this.log.warn({ err }, "metrics flush failed; dropped one batch");
    }
  }

  private prune(nowSec: number): void {
    this.statements.prune.metrics_minute.run(nowSec - MINUTE_RETENTION_SECONDS);
    this.statements.prune.metrics_hour.run(nowSec - this.retentionDays * 86_400);
    this.lastPruneSec = nowSec;
  }

  report(window: MetricsWindow): MetricsReport {
    this.flush();
    const spec = WINDOWS[window];
    const nowSec = Math.floor(this.now() / 1000);
    const start = nowSec - spec.seconds;
    const fromSec = start - (start % spec.stepSeconds);
    const layerTotals = new Map<MetricsLayer, Totals>();
    const operations: OperationMetrics[] = [];
    for (const row of this.statements.operations[spec.table].all(fromSec)) {
      const layer = METRICS_LAYERS.find((l) => l === str(row, "layer"));
      if (!layer) continue;
      const totals = totalsOf(row);
      operations.push({ layer, op: str(row, "op"), ...statsOf(totals) });
      const sum = layerTotals.get(layer);
      if (sum) merge(sum, totals);
      else layerTotals.set(layer, { ...totals, buckets: [...totals.buckets] });
    }
    operations.sort(
      (a, b) =>
        METRICS_LAYERS.indexOf(a.layer) - METRICS_LAYERS.indexOf(b.layer) ||
        b.count - a.count ||
        (a.op < b.op ? -1 : a.op > b.op ? 1 : 0),
    );

    const layers: LayerMetrics[] = METRICS_LAYERS.flatMap((layer) => {
      const totals = layerTotals.get(layer);
      return totals ? [{ layer, ...statsOf(totals) }] : [];
    });

    const series: MetricsPoint[] = [];
    for (const row of this.statements.series[spec.table].all(spec.stepSeconds, fromSec)) {
      const layer = METRICS_LAYERS.find((l) => l === str(row, "layer"));
      if (!layer) continue;
      const stats = statsOf(totalsOf(row));
      series.push({
        at: iso(num(row, "t")),
        layer,
        count: stats.count,
        serverErrors: stats.serverErrors,
        avgMs: stats.avgMs,
        p95Ms: stats.p95Ms,
      });
    }

    return { window, from: iso(fromSec), to: iso(nowSec), stepSeconds: spec.stepSeconds, layers, operations, series };
  }

  /** Idempotent: stops the timer, flushes, and closes the database. */
  close(): void {
    if (this.closed) return;
    clearInterval(this.timer);
    this.flush();
    this.closed = true;
    this.db.close();
  }
}
