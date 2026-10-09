import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { finished } from "node:stream/promises";
import { setImmediate } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Logger, loadConfig } from "../config.js";
import { KnowledgeService } from "../service/knowledge-service.js";
import type { Principal } from "../service/principal.js";
import { Catalog } from "../store/catalog.js";
import { GitBackend } from "../store/git-backend.js";
import { InstrumentedStorage, instrumentService, type MetricsSink, type Outcome } from "./instrument.js";
import type { MetricsLayer } from "./types.js";

const mockLogger: Logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

const alice: Principal = {
  subject: "u1",
  clientId: "c1",
  identity: "alice",
  groups: [],
  scopes: ["okf:read", "okf:write", "okf:admin"],
  canRead: true,
  canWrite: true,
  canAdmin: true,
};

interface Recorded {
  layer: MetricsLayer;
  op: string;
  outcome: Outcome;
}

describe("instrumentation", () => {
  let dataDir: string;
  let storage: InstrumentedStorage;
  let service: KnowledgeService;
  let records: Recorded[];

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "okf-"));
    const config = loadConfig({
      DATA_DIR: dataDir,
      PUBLIC_BASE_URL: "https://okf.test",
      OAUTH_ISSUER: "https://auth.test",
      LOG_LEVEL: "silent",
    });
    records = [];
    const sink: MetricsSink = { record: (layer, op, _startedAt, outcome) => records.push({ layer, op, outcome }) };
    storage = new InstrumentedStorage(await GitBackend.open(config, mockLogger), sink);
    const raw = new KnowledgeService({ config, storage, catalog: new Catalog(), log: mockLogger });
    await raw.initialize();
    service = instrumentService(raw, sink);
    records.length = 0;
  });

  afterEach(async () => {
    await storage.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  it("records one service op per outer call with its outcome, plus the storage calls beneath it", async () => {
    await service.createProject(alice, { project: "demo", title: "Demo", actor: "test/1.0" });
    expect(records).toContainEqual({ layer: "service", op: "createProject", outcome: "ok" });
    expect(records).toContainEqual({ layer: "storage", op: "transaction", outcome: "ok" });
    expect(records).toContainEqual({ layer: "storage", op: "tx.writeFile", outcome: "ok" });

    await expect(service.readConcept(alice, "demo", "missing")).rejects.toMatchObject({ code: "not_found" });
    expect(records).toContainEqual({ layer: "service", op: "readConcept", outcome: "client_error" });

    expect(service.listProjects(alice).projects.map((p) => p.project)).toContain("demo");
    expect(records).toContainEqual({ layer: "service", op: "listProjects", outcome: "ok" });

    const serviceOps = records.filter((r) => r.layer === "service").map((r) => r.op);
    expect(new Set(serviceOps)).toEqual(new Set(["createProject", "readConcept", "listProjects"]));
  });

  it("records archive exports when the stream finishes, not when it is returned", async () => {
    await service.createProject(alice, { project: "demo", title: "Demo", actor: "test/1.0" });
    records.length = 0;

    const stream = service.exportArchive(alice, "demo");
    expect(records.some((r) => r.op === "exportArchive" || r.op === "archive")).toBe(false);

    stream.resume();
    await finished(stream);
    await setImmediate();
    expect(records).toContainEqual({ layer: "service", op: "exportArchive", outcome: "ok" });
    expect(records).toContainEqual({ layer: "storage", op: "archive", outcome: "ok" });
  });
});
