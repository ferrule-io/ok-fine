import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { Logger } from "../config.js";
import { BUCKET_COUNT, bucketIndex, quantile } from "./histogram.js";
import { MetricsStore } from "./store.js";

const DAY_MS = 86_400_000;
const T = Date.parse("2026-10-09T12:00:30Z");

function fakeLog(): Logger & { warn: Mock<Logger["warn"]> } {
  return { info: vi.fn(), warn: vi.fn<Logger["warn"]>(), error: vi.fn(), debug: vi.fn() };
}

describe("quantile", () => {
  it("interpolates inside the bucket and clamps to the observed range", () => {
    const buckets = new Array<number>(BUCKET_COUNT).fill(0);
    buckets[bucketIndex(7)] = 100;
    expect(quantile(buckets, 0.5, 5.1, 9.9)).toBe(7.5);
    expect(quantile(buckets, 0.99, 5.1, 9.9)).toBe(9.9);
  });

  it("returns 0 when empty and the max for an overflow-only sample", () => {
    expect(quantile(new Array<number>(BUCKET_COUNT).fill(0), 0.95, 0, 0)).toBe(0);
    const buckets = new Array<number>(BUCKET_COUNT).fill(0);
    buckets[bucketIndex(45_000)] = 1;
    expect(quantile(buckets, 0.5, 45_000, 45_000)).toBe(45_000);
  });
});

describe("MetricsStore", () => {
  let dir: string;
  let dbPath: string;
  let clock: number;
  const stores: MetricsStore[] = [];

  const open = async (options: { retentionDays?: number; log?: Logger } = {}): Promise<MetricsStore> => {
    const store = await MetricsStore.open({
      path: dbPath,
      retentionDays: options.retentionDays ?? 30,
      log: options.log ?? fakeLog(),
      now: () => clock,
    });
    stores.push(store);
    return store;
  };

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "okf-"));
    dbPath = path.join(dir, "metrics.sqlite");
    clock = T;
  });

  afterEach(async () => {
    for (const s of stores.splice(0)) s.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("aggregates observations across flushes and persists them across reopen", async () => {
    const store = await open();
    store.observe("service", "readConcept", 2, "ok");
    store.observe("service", "readConcept", 4, "client_error");
    store.flush();
    store.observe("service", "readConcept", 6, "server_error");
    store.observe("storage", "tree", 0.05, "ok");

    const report = store.report("1h");
    expect(report.from).toBe("2026-10-09T11:00:00.000Z");
    expect(report.to).toBe("2026-10-09T12:00:30.000Z");
    expect(report.stepSeconds).toBe(60);
    expect(report.operations.find((o) => o.op === "readConcept")).toMatchObject({
      layer: "service",
      count: 3,
      clientErrors: 1,
      serverErrors: 1,
      avgMs: 4,
      maxMs: 6,
    });
    expect(report.layers.map((l) => l.layer)).toEqual(["service", "storage"]);
    expect(report.series.filter((p) => p.layer === "service")).toEqual([
      expect.objectContaining({ at: "2026-10-09T12:00:00.000Z", count: 3, serverErrors: 1 }),
    ]);

    store.close();
    const reopened = await open();
    expect(reopened.report("24h").operations.find((o) => o.op === "readConcept")?.count).toBe(3);
  });

  it("keeps hourly rows for retentionDays and prunes them afterwards", async () => {
    const store = await open({ retentionDays: 3 });
    store.observe("service", "listProjects", 1, "ok");
    clock = T + 2 * DAY_MS;
    expect(store.report("7d").operations.map((o) => o.count)).toEqual([1]);
    clock = T + 4 * DAY_MS;
    store.flush();
    expect(store.report("7d").operations).toEqual([]);
  });

  it("recreates an unreadable database", async () => {
    await fs.writeFile(dbPath, "not a database, padded to look like a page of something else entirely");
    const log = fakeLog();
    const store = await open({ log });
    expect(log.warn).toHaveBeenCalledWith(expect.anything(), "metrics database unusable; recreating it");
    expect(store.report("1h").operations).toEqual([]);
    store.observe("service", "listProjects", 1, "ok");
    expect(store.report("1h").operations).toHaveLength(1);
  });
});
