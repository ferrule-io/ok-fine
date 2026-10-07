import { execSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import * as tar from "tar";
import { afterEach, describe, expect, it } from "vitest";
import { type Config, type Logger, loadConfig } from "../config.js";
import { OkfError } from "../errors.js";
import { Catalog } from "../store/catalog.js";
import { GitBackend } from "../store/git-backend.js";
import { KnowledgeService } from "./knowledge-service.js";
import type { Principal } from "./principal.js";

const mockLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

const alice: Principal = {
  subject: "u1",
  clientId: "c1",
  identity: "alice",
  scopes: ["okf:read", "okf:write", "okf:admin"],
  canRead: true,
  canWrite: true,
  canAdmin: true,
};

describe("KnowledgeService", () => {
  let tempDirs: string[] = [];

  async function createTempDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "okf-"));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(async () => {
    for (const dir of tempDirs) {
      await rm(dir, { recursive: true, force: true });
    }
    tempDirs = [];
  });

  async function setupService(extraEnv: Record<string, string> = {}): Promise<{
    service: KnowledgeService;
    storage: GitBackend;
    dataDir: string;
    config: Config;
  }> {
    const dataDir = await createTempDir();
    const config = loadConfig({
      DATA_DIR: dataDir,
      PUBLIC_BASE_URL: "https://okf.test",
      OAUTH_ISSUER: "https://auth.test",
      LOG_LEVEL: "silent",
      ...extraEnv,
    });
    const storage = await GitBackend.open(config, mockLogger);
    const catalog = new Catalog();
    const service = new KnowledgeService({ config, storage, catalog, log: mockLogger });
    await service.initialize();
    return { service, storage, dataDir, config };
  }

  it("per-concept lint reports a missing computation file until the file is written", async () => {
    const { service } = await setupService();
    await service.createProject(alice, { project: "calc", title: "Calc", actor: "test/1.0" });
    const written = await service.writeConcept(alice, {
      project: "calc",
      id: "computations/revenue",
      frontmatter: { type: "Attested Computation", title: "Revenue", runtime: "python3", computation: "revenue.py" },
      body: "Computes revenue.",
      actor: "test/1.0",
    });
    expect(written.issues.map((i) => i.code)).toContain("computation_file_missing");

    await service.writeFile(alice, {
      project: "calc",
      path: "computations/revenue.py",
      content: "print(1)\n",
      actor: "test/1.0",
    });
    const read = await service.readConcept("calc", "computations/revenue");
    expect(read.issues.map((i) => i.code)).not.toContain("computation_file_missing");
  });

  it("rejects project names that escape the repository before touching disk", async () => {
    const { service, dataDir } = await setupService();
    await writeFile(join(dataDir, "canary.txt"), "keep");
    await writeFile(join(dataDir, "repo", "outside.txt"), "keep");

    const attempts: Array<() => Promise<unknown>> = [
      () => service.deleteProject(alice, { project: "..", actor: "test/1.0" }),
      () => service.deleteProject(alice, { project: ".", actor: "test/1.0" }),
      () => service.readFile("..", "canary.txt"),
      () => service.readFile(".", "outside.txt"),
      () => service.getProject(".."),
      () => service.lint("../repo"),
      () => service.writeFile(alice, { project: "..", path: "x.txt", content: "x", actor: "test/1.0" }),
    ];
    for (const attempt of attempts) {
      await expect(attempt()).rejects.toMatchObject({ code: "invalid_id", status: 400 });
    }
    expect(await readFile(join(dataDir, "canary.txt"), "utf8")).toBe("keep");
    expect(await readFile(join(dataDir, "repo", "outside.txt"), "utf8")).toBe("keep");
    expect(
      execSync("git rev-list --count HEAD", { cwd: join(dataDir, "repo") })
        .toString()
        .trim(),
    ).toBe("1");
  });

  it("listProjects returns bound repositories and filters by normalized git remote", async () => {
    const { service } = await setupService();
    await service.createProject(alice, { project: "alpha", title: "Alpha", actor: "test/1.0" });
    await service.createProject(alice, { project: "beta", title: "Beta", actor: "test/1.0" });
    await service.writeConcept(alice, {
      project: "alpha",
      id: "overview",
      frontmatter: { type: "Project", title: "Alpha", repositories: ["git@github.com:Acme/Shop.git"] },
      body: "# Alpha\n",
      actor: "test/1.0",
    });

    const filtered = service.listProjects({ repository: "https://github.com/acme/shop" });
    expect(filtered.projects.map((p) => [p.project, p.repositories])).toEqual([["alpha", ["github.com/acme/shop"]]]);

    const all = service.listProjects();
    expect(Object.fromEntries(all.projects.map((p) => [p.project, p.repositories]))).toEqual({
      alpha: ["github.com/acme/shop"],
      beta: [],
    });

    expect(() => service.listProjects({ repository: "/tmp/shop" })).toThrowError(
      expect.objectContaining({ code: "bad_request", status: 400 }),
    );
  });

  it("create project + write concept records correctly in catalog, index.md, log.md, and git", async () => {
    const { service, dataDir } = await setupService();

    // 1. Create project
    await service.createProject(alice, {
      project: "demo",
      title: "Demo Project",
      description: "A test project",
      actor: "human:alice",
    });

    // 2. Write concept
    const writeRes = await service.writeConcept(alice, {
      project: "demo",
      id: "tables/orders",
      frontmatter: {
        type: "Reference",
        title: "Customer Orders",
        description: "Table of orders",
        tags: ["sales"],
      },
      body: "# Customer Orders\n\nNotes about orders.",
      actor: "agent/test-1.0",
    });

    expect(writeRes.created).toBe(true);

    // 3. Read concept
    const conceptView = await service.readConcept("demo", "tables/orders");
    expect(conceptView.derived?.trustTier).toBe("unverified");
    expect(conceptView.derived?.title).toBe("Customer Orders");

    // 4. Verify root index.md lists directory, tables/index.md lists concept
    const rootIndex = await service.getIndex("demo", "");
    expect(rootIndex.markdown).toContain("# Directories");
    expect(rootIndex.markdown).toContain("* [tables](tables/) - 1 concept");

    const tablesIndex = await service.getIndex("demo", "tables");
    expect(tablesIndex.markdown).toContain("# Reference");
    expect(tablesIndex.markdown).toContain("* [Customer Orders](orders.md) - Table of orders");
    // 5. Verify log.md has creation entry
    const logContent = await readFile(join(dataDir, "repo", "demo", "log.md"), "utf8");
    expect(logContent).toContain("**Creation**: Added [Customer Orders](/tables/orders.md) (by agent/test-1.0).");

    // 6. Check git log author and trailers
    const gitLog = execSync(`git log -1 --format="%an%n%(trailers:key=Okf-Principal,valueonly)"`, {
      cwd: join(dataDir, "repo"),
    })
      .toString("utf8")
      .trim();

    expect(gitLog).toBe("agent/test-1.0\nsub=u1 client=c1");
  });

  it("handles revision conflicts and already_exists", async () => {
    const { service } = await setupService();

    await service.createProject(alice, {
      project: "demo",
      title: "Demo",
      actor: "human:alice",
    });

    const initial = await service.writeConcept(alice, {
      project: "demo",
      id: "concept-a",
      frontmatter: { type: "Note", title: "Note A" },
      body: "body",
      actor: "human:alice",
    });

    // Stale expectedRevision
    await expect(
      service.writeConcept(alice, {
        project: "demo",
        id: "concept-a",
        frontmatter: { type: "Note", title: "Updated" },
        body: "body",
        actor: "human:alice",
        expectedRevision: "deadbeef00000000000000000000000000000000",
      }),
    ).rejects.toThrowError(OkfError);

    try {
      await service.writeConcept(alice, {
        project: "demo",
        id: "concept-a",
        frontmatter: { type: "Note", title: "Updated" },
        body: "body",
        actor: "human:alice",
        expectedRevision: "deadbeef00000000000000000000000000000000",
      });
    } catch (e) {
      expect((e as OkfError).code).toBe("revision_conflict");
      expect((e as OkfError).details).toEqual({ currentRevision: initial.revision });
    }

    // expectedRevision: null on existing concept -> already_exists
    await expect(
      service.writeConcept(alice, {
        project: "demo",
        id: "concept-a",
        frontmatter: { type: "Note", title: "Updated" },
        body: "body",
        actor: "human:alice",
        expectedRevision: null,
      }),
    ).rejects.toThrowError(OkfError);

    try {
      await service.writeConcept(alice, {
        project: "demo",
        id: "concept-a",
        frontmatter: { type: "Note", title: "Updated" },
        body: "body",
        actor: "human:alice",
        expectedRevision: null,
      });
    } catch (e) {
      expect((e as OkfError).code).toBe("already_exists");
    }
  });

  it("actor binding enforces identity claim for humans", async () => {
    const { service } = await setupService();

    await service.createProject(alice, {
      project: "demo",
      title: "Demo",
      actor: "human:alice",
    });

    // human:alice accepted
    await expect(
      service.writeConcept(alice, {
        project: "demo",
        id: "c1",
        frontmatter: { type: "Note" },
        body: "b",
        actor: "human:alice",
      }),
    ).resolves.toBeDefined();

    // human:bob -> forbidden_actor
    await expect(
      service.writeConcept(alice, {
        project: "demo",
        id: "c2",
        frontmatter: { type: "Note" },
        body: "b",
        actor: "human:bob",
      }),
    ).rejects.toThrowError(OkfError);

    // team:x -> invalid_actor
    await expect(
      service.writeConcept(alice, {
        project: "demo",
        id: "c3",
        frontmatter: { type: "Note" },
        body: "b",
        actor: "team:x",
      }),
    ).rejects.toThrowError(OkfError);
  });

  it("verifyConcept updates trust tier from machine-confirmed to human-reviewed with generated untouched", async () => {
    const { service } = await setupService();

    await service.createProject(alice, {
      project: "demo",
      title: "Demo",
      actor: "human:alice",
    });

    await service.writeConcept(alice, {
      project: "demo",
      id: "doc",
      frontmatter: { type: "Doc", title: "Original" },
      body: "Content",
      actor: "agent/1.0",
    });

    const v1 = await service.readConcept("demo", "doc");
    const originalGenerated = v1.derived?.generatedAt;
    expect(v1.derived?.trustTier).toBe("unverified");

    // Verify by process:ci -> machine-confirmed
    await service.verifyConcept(alice, {
      project: "demo",
      id: "doc",
      actor: "process:ci",
    });

    const v2 = await service.readConcept("demo", "doc");
    expect(v2.derived?.trustTier).toBe("machine-confirmed");
    expect(v2.derived?.generatedAt).toBe(originalGenerated);

    // Verify by human:alice -> human-reviewed
    await service.verifyConcept(alice, {
      project: "demo",
      id: "doc",
      actor: "human:alice",
    });

    const v3 = await service.readConcept("demo", "doc");
    expect(v3.derived?.trustTier).toBe("human-reviewed");
    expect(v3.derived?.generatedAt).toBe(originalGenerated);
    expect(Array.isArray(v3.frontmatter?.verified)).toBe(true);
    expect(v3.frontmatter?.verified).toHaveLength(2);
  });

  it("writeConcept echoing a different verified ignores it and leaves tier unchanged", async () => {
    const { service } = await setupService();

    await service.createProject(alice, {
      project: "demo",
      title: "Demo",
      actor: "human:alice",
    });

    await service.writeConcept(alice, {
      project: "demo",
      id: "doc",
      frontmatter: { type: "Doc", title: "Doc" },
      body: "Content",
      actor: "agent/1.0",
    });

    // Verify by human:alice
    await service.verifyConcept(alice, {
      project: "demo",
      id: "doc",
      actor: "human:alice",
    });

    // Now writeConcept trying to overwrite verified with something else
    const res = await service.writeConcept(alice, {
      project: "demo",
      id: "doc",
      frontmatter: {
        type: "Doc",
        title: "Doc Updated",
        verified: [{ by: "human:someone_else", at: "2020-01-01T00:00:00Z" }],
      },
      body: "Content",
      actor: "agent/1.0",
    });

    expect(res.ignoredKeys).toContain("verified");
    const doc = await service.readConcept("demo", "doc");
    expect(doc.derived?.trustTier).toBe("human-reviewed");
  });

  it("search: title match outranks body match, hides deprecated by default, and filters by stale", async () => {
    const { service } = await setupService();

    await service.createProject(alice, {
      project: "demo",
      title: "Demo",
      actor: "human:alice",
    });

    // Doc 1: title has "Database"
    await service.writeConcept(alice, {
      project: "demo",
      id: "doc1",
      frontmatter: { type: "Guide", title: "Database Systems" },
      body: "Notes on storage.",
      actor: "agent/1.0",
    });

    // Doc 2: body has "Database"
    await service.writeConcept(alice, {
      project: "demo",
      id: "doc2",
      frontmatter: { type: "Guide", title: "Architecture" },
      body: "We use a Database for state.",
      actor: "agent/1.0",
    });

    // Search query "database"
    const hits = await service.search({ query: "Database" });
    expect(hits.results.length).toBe(2);
    expect(hits.results[0]?.id).toBe("doc1");
    expect(hits.results[1]?.id).toBe("doc2");

    // Deprecated concept
    await service.writeConcept(alice, {
      project: "demo",
      id: "doc-dep",
      frontmatter: { type: "Guide", title: "Deprecated Database Guide", status: "deprecated" },
      body: "Old db stuff.",
      actor: "agent/1.0",
    });

    const hitsWithoutDep = await service.search({ query: "Database" });
    expect(hitsWithoutDep.results.some((r) => r.id === "doc-dep")).toBe(false);

    const hitsWithDep = await service.search({ query: "Database", status: "deprecated" });
    expect(hitsWithDep.results.some((r) => r.id === "doc-dep")).toBe(true);

    // Stale filter
    await service.writeConcept(alice, {
      project: "demo",
      id: "doc-stale",
      frontmatter: {
        type: "Guide",
        title: "Stale Guide",
        stale_after: "2020-01-01T00:00:00Z",
      },
      body: "Past its prime.",
      actor: "agent/1.0",
    });

    const staleOnly = await service.search({ stale: true });
    expect(staleOnly.results.map((r) => r.id)).toEqual(["doc-stale"]);
  });

  it("links: inbound links, brokenInbound on delete, lint broken_link, and index directory cleanup", async () => {
    const { service } = await setupService();

    await service.createProject(alice, {
      project: "demo",
      title: "Demo",
      actor: "human:alice",
    });

    // Write B
    await service.writeConcept(alice, {
      project: "demo",
      id: "tables/b",
      frontmatter: { type: "Table", title: "Table B" },
      body: "B table",
      actor: "agent/1.0",
    });

    // Write A linking to /tables/b.md
    await service.writeConcept(alice, {
      project: "demo",
      id: "a",
      frontmatter: { type: "Doc", title: "Doc A" },
      body: "See [Table B](/tables/b.md)",
      actor: "agent/1.0",
    });

    const bView = await service.readConcept("demo", "tables/b");
    expect(bView.links.inbound).toEqual(["a"]);

    // Delete B
    const delRes = await service.deleteConcept(alice, {
      project: "demo",
      id: "tables/b",
      actor: "agent/1.0",
    });
    expect(delRes.brokenInbound).toEqual(["a"]);

    // Lint A reports broken_link
    const aView = await service.readConcept("demo", "a");
    expect(aView.issues.some((i) => i.code === "broken_link")).toBe(true);

    // Directory tables has no more concepts, so tables/index.md should be pruned
    await expect(service.getIndex("demo", "tables")).rejects.toThrow();

    // Recreating B restores A's inbound link without A being rewritten
    await service.writeConcept(alice, {
      project: "demo",
      id: "tables/b",
      frontmatter: { type: "Table", title: "Table B" },
      body: "B table again",
      actor: "agent/1.0",
    });
    expect((await service.readConcept("demo", "tables/b")).links.inbound).toEqual(["a"]);
  });

  it("remote sync with bare repo: write propagation, external clone push, conflict branch preservation", async () => {
    // Set up bare remote repo
    const bareDir = await createTempDir();
    execSync("git init --bare -b main", { cwd: bareDir });

    const { service, storage } = await setupService({
      GIT_REMOTE_URL: bareDir,
    });

    // 1. A write appears on the remote
    await service.createProject(alice, {
      project: "alpha",
      title: "Alpha Project",
      actor: "human:alice",
    });

    const remoteLog1 = execSync("git log -1 --format=%s", { cwd: bareDir }).toString("utf8").trim();
    expect(remoteLog1).toBe("okf(alpha): create project");

    // 2. An external clone pushes alpha/tables/orders.md -> syncNow() updates catalog & regenerates indexes
    const extDir = await createTempDir();
    execSync(`git clone -b main "${bareDir}" .`, { cwd: extDir });
    execSync("git config user.name test && git config user.email test@test", { cwd: extDir });

    const extOrdersDir = join(extDir, "alpha", "tables");
    await mkdtemp(join(tmpdir(), "dummy-")); // ensure temp call
    const extOrdersPath = join(extOrdersDir, "orders.md");
    execSync(`mkdir -p "${extOrdersDir}"`);
    await writeFile(
      extOrdersPath,
      `---
type: Reference
title: Orders
description: External orders
---

# Orders Content
`,
      "utf8",
    );
    execSync("git add alpha/tables/orders.md", { cwd: extDir });
    execSync('git commit -m "ext: add orders"', { cwd: extDir });
    execSync("git push origin main", { cwd: extDir });

    // Sync in service
    await service.syncNow();

    // Catalog finds it
    const ordersRecord = service.catalog.get("alpha", "tables/orders");
    expect(ordersRecord).toBeDefined();
    expect(ordersRecord?.title).toBe("Orders");

    // Remote now has a process:ok-fine commit adding alpha/tables/index.md
    const remoteHeadSubject = execSync("git log -1 --format=%s", { cwd: bareDir }).toString("utf8").trim();
    expect(remoteHeadSubject).toBe("okf(alpha): regenerate indexes");

    // 3. Conflict handling
    // Break origin URL in local git to prevent push
    await storage.git.run(["remote", "set-url", "origin", "/nonexistent/repo.git"]);

    // Write concept X locally (push fails, but local commit succeeds)
    const writeX = await service.writeConcept(alice, {
      project: "alpha",
      id: "concept-x",
      frontmatter: { type: "Note", title: "Local X" },
      body: "Local content",
      actor: "agent/1.0",
    });
    expect(writeX.pushed).toBe(false);
    expect(writeX.warnings.some((w) => w.startsWith("push failed"))).toBe(true);

    // Restore origin URL
    await storage.git.run(["remote", "set-url", "origin", bareDir]);

    // Pull external clone up to date with remote
    execSync("git pull --rebase origin main", { cwd: extDir });

    // External clone commits conflicting concept-x
    await writeFile(
      join(extDir, "alpha", "concept-x.md"),
      `---
type: Note
title: Remote X
---

# Remote conflicting content
`,
      "utf8",
    );
    execSync("git add alpha/concept-x.md", { cwd: extDir });
    execSync('git commit -m "ext: conflicting concept-x"', { cwd: extDir });
    execSync("git push origin main", { cwd: extDir });

    // Sync now should fail rebase, push the per-project conflict branch, and reset to origin/main
    const syncStatus = await service.syncNow();
    expect(syncStatus.lastError).toMatch(/^rebase conflict; local commits preserved as conflict \S+ in alpha$/);

    // Remote conflict branch holds the original local commit with the local content
    const branch = execSync("git for-each-ref --format='%(refname:short)' refs/heads/ok-fine/", { cwd: bareDir })
      .toString("utf8")
      .trim();
    expect(branch).toMatch(/^ok-fine\/conflict\/alpha\/\d{8}T\d{6}\.\d{3}Z-[0-9a-f]{12}$/);
    const preserved = execSync(`git show ${branch}:alpha/concept-x.md`, { cwd: bareDir }).toString("utf8");
    expect(preserved).toContain("title: Local X");
    expect(execSync(`git log -1 --format=%an ${branch}`, { cwd: bareDir }).toString("utf8").trim()).toBe("agent/1.0");

    // Local HEAD is now equal to origin/main, and the catalog reflects the remote version
    const localHead = (await storage.git.run(["rev-parse", "HEAD"])).stdout.trim();
    const originMain = (await storage.git.run(["rev-parse", "origin/main"])).stdout.trim();
    expect(localHead).toBe(originMain);
    const afterSync = await service.readConcept("alpha", "concept-x");
    expect(afterSync.derived?.title).toBe("Remote X");
    expect((await service.search({ query: "Remote" })).results.map((r) => r.id)).toContain("concept-x");

    // The conflict surfaces in lint and on the concept, scoped to its project
    const conflictId = branch.split("/").pop() ?? "";
    const conflictIssue = {
      severity: "warning",
      code: "unresolved_conflict",
      path: "concept-x.md",
      message: expect.stringContaining(conflictId),
    };
    expect((await service.lint("alpha")).issues).toContainEqual(conflictIssue);
    expect(afterSync.issues).toContainEqual(conflictIssue);
    const listed = await service.listConflicts("alpha");
    expect(listed.conflicts.map((c) => [c.id, c.files, c.commits.map((h) => h.actor)])).toEqual([
      [conflictId, [{ path: "concept-x.md", change: "added", divergent: true }], ["agent/1.0"]],
    ]);
    await service.createProject(alice, { project: "beta", title: "Beta", actor: "human:alice" });
    expect((await service.listConflicts("beta")).conflicts).toEqual([]);
    expect((await service.lint("beta")).issues.map((i) => i.code)).not.toContain("unresolved_conflict");

    const sides = await service.readConflict("alpha", conflictId, "concept-x.md");
    expect(sides.preserved).toContain("title: Local X");
    expect(sides.base).toBeNull();
    expect(sides.current?.content).toContain("title: Remote X");
    expect(sides.current?.revision).toBe(afterSync.revision);
    await expect(service.readConflict("alpha", "20260101T000000Z-000000000000", "concept-x.md")).rejects.toMatchObject({
      code: "not_found",
    });

    // Merge, then resolve: every file must be acknowledged
    await service.writeConcept(alice, {
      project: "alpha",
      id: "concept-x",
      frontmatter: { type: "Note", title: "Merged X" },
      body: "Local content\n\n# Remote conflicting content",
      actor: "agent/1.0",
      expectedRevision: sides.current?.revision ?? null,
    });
    await expect(
      service.resolveConflict(alice, { project: "alpha", id: conflictId, paths: [], actor: "agent/1.0" }),
    ).rejects.toMatchObject({ code: "bad_request", details: { unacknowledged: ["concept-x.md"] } });
    expect((await service.listConflicts("alpha")).conflicts).toHaveLength(1);

    const resolved = await service.resolveConflict(alice, {
      project: "alpha",
      id: conflictId,
      paths: ["concept-x.md"],
      actor: "agent/1.0",
      message: "kept both bodies",
    });
    expect(resolved.pushed).toBe(true);
    expect((await service.listConflicts("alpha")).conflicts).toEqual([]);
    expect((await service.readConcept("alpha", "concept-x")).issues.map((i) => i.code)).not.toContain(
      "unresolved_conflict",
    );
    expect(execSync("git for-each-ref refs/heads/ok-fine/", { cwd: bareDir }).toString("utf8")).toBe("");
    expect(execSync("git for-each-ref refs/ok-fine/resolved/", { cwd: storage.repoDir }).toString("utf8")).toBe("");
    expect((await service.readFile("alpha", "log.md")).content).toContain(
      `**Conflict resolution**: Resolved conflict \`${conflictId}\` (by agent/1.0). kept both bodies`,
    );
    await expect(
      service.resolveConflict(alice, { project: "alpha", id: conflictId, paths: [], actor: "agent/1.0" }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("archive: export -> import roundtrips concepts, rejects invalid archives without modifying state", async () => {
    const { service, storage } = await setupService();

    await service.createProject(alice, {
      project: "source",
      title: "Source Project",
      actor: "human:alice",
    });

    await service.writeConcept(alice, {
      project: "source",
      id: "overview",
      frontmatter: { type: "Project", title: "Source Project" },
      body: "Overview text",
      actor: "agent/1.0",
    });

    await service.writeConcept(alice, {
      project: "source",
      id: "tables/customers",
      frontmatter: { type: "Table", title: "Customers" },
      body: "Customers table",
      actor: "agent/1.0",
    });

    // Export archive
    const stream = service.exportArchive("source");
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    }
    const archiveBuf = Buffer.concat(chunks);

    // Import into target
    const importRes = await service.importArchive(alice, {
      project: "target",
      actor: "human:alice",
      archive: archiveBuf,
    });

    expect(importRes.conceptCount).toBe(2);
    expect(service.catalog.get("target", "overview")).toBeDefined();
    expect(service.catalog.get("target", "tables/customers")).toBeDefined();

    // Test rejection: archive with ../evil.md
    function createTarWithEntry(entryName: string): Buffer {
      const header = Buffer.alloc(512);
      header.write(entryName, 0, 100);
      header.write("0000644\0", 100, 8);
      header.write("0000000\0", 108, 8);
      header.write("0000000\0", 116, 8);
      header.write("00000000000\0", 124, 12);
      header.write("00000000000\0", 136, 12);
      header.write("0", 156, 1);
      header.write("ustar\0", 257, 6);
      header.write("00", 263, 2);

      header.fill(" ", 148, 156);
      let chksum = 0;
      for (const byte of header) chksum += byte;
      const chkStr = `${chksum.toString(8).padStart(6, "0")}\0 `;
      header.write(chkStr, 148, 8);

      const endBlocks = Buffer.alloc(1024);
      const tarBuf = Buffer.concat([header, endBlocks]);
      return gzipSync(tarBuf);
    }

    const headBefore = (await storage.git.run(["rev-parse", "HEAD"])).stdout.trim();
    const targetFilesBefore = execSync("git ls-files target", { cwd: storage.repoDir }).toString("utf8");

    const badTraversalBuf = createTarWithEntry("../evil.md");
    await expect(
      service.importArchive(alice, { project: "target", actor: "human:alice", archive: badTraversalBuf }),
    ).rejects.toMatchObject({ code: "invalid_archive" });
    // Let's create an in-memory tar or test archive_layout with multiple roots:
    const twoRootsDir = await createTempDir();
    execSync(`mkdir -p "${join(twoRootsDir, "root1")}" "${join(twoRootsDir, "root2")}"`);
    await writeFile(join(twoRootsDir, "root1", "a.md"), "---\ntype: Note\n---\n# A");
    await writeFile(join(twoRootsDir, "root2", "b.md"), "---\ntype: Note\n---\n# B");

    const twoRootsTarChunks: Buffer[] = [];
    const p2 = tar.c({ gzip: true, cwd: twoRootsDir }, ["root1", "root2"]);
    for await (const chunk of p2) twoRootsTarChunks.push(chunk);
    const twoRootsBuf = Buffer.concat(twoRootsTarChunks);

    await expect(
      service.importArchive(alice, { project: "target", actor: "human:alice", archive: twoRootsBuf }),
    ).rejects.toMatchObject({ code: "archive_layout" });

    // Symlink entry rejection
    const symlinkDir = await createTempDir();
    execSync(`mkdir -p "${join(symlinkDir, "bundle")}"`);
    await writeFile(join(symlinkDir, "bundle", "real.txt"), "hello");
    await symlink("real.txt", join(symlinkDir, "bundle", "sym.txt"));

    const symTarChunks: Buffer[] = [];
    const pSym = tar.c({ gzip: true, cwd: symlinkDir }, ["bundle"]);
    for await (const chunk of pSym) symTarChunks.push(chunk);
    const symBuf = Buffer.concat(symTarChunks);

    await expect(
      service.importArchive(alice, { project: "target", actor: "human:alice", archive: symBuf }),
    ).rejects.toMatchObject({ code: "invalid_archive" });

    // Non-conformant bundle: concept without type
    const nonConfDir = await createTempDir();
    execSync(`mkdir -p "${join(nonConfDir, "bundle")}"`);
    await writeFile(join(nonConfDir, "bundle", "bad.md"), "---\ntitle: Missing Type\n---\n# No type");

    const nonConfChunks: Buffer[] = [];
    const pNonConf = tar.c({ gzip: true, cwd: nonConfDir }, ["bundle"]);
    for await (const chunk of pNonConf) nonConfChunks.push(chunk);
    const nonConfBuf = Buffer.concat(nonConfChunks);

    const nonConformant = await service
      .importArchive(alice, { project: "target", actor: "human:alice", archive: nonConfBuf })
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(nonConformant).toBeInstanceOf(OkfError);
    expect(nonConformant).toMatchObject({
      code: "bundle_not_conformant",
      status: 422,
      details: { issues: expect.arrayContaining([expect.objectContaining({ code: "missing_type", path: "bad.md" })]) },
    });

    // Nothing changed: no commit, same tracked files, catalog intact, no staging leftovers
    expect((await storage.git.run(["rev-parse", "HEAD"])).stdout.trim()).toBe(headBefore);
    expect(execSync("git ls-files target", { cwd: storage.repoDir }).toString("utf8")).toBe(targetFilesBefore);
    expect(execSync("git status --porcelain", { cwd: storage.repoDir }).toString("utf8")).toBe("");
    expect(service.catalog.get("target", "tables/customers")).toBeDefined();
    expect(await readdir(join(service.config.dataDir, "tmp"))).toEqual([]);
  });

  it("defaultStaleAfterDays: stamps stale_after on create/update when omitted, preserves explicit values, does nothing when unset", async () => {
    // 1. With defaultStaleAfterDays set
    const { service: configuredService } = await setupService({ DEFAULT_STALE_AFTER_DAYS: "30" });
    await configuredService.createProject(alice, {
      project: "proj-configured",
      title: "Configured",
      actor: "human:alice",
    });

    const beforeWrite = Date.now();
    // (a) creating a concept without stale_after yields a stale_after ≈ now + N days
    await configuredService.writeConcept(alice, {
      project: "proj-configured",
      id: "concepts/auto-stale",
      frontmatter: { type: "Convention", title: "Auto Stale Concept" },
      body: "Body content",
      actor: "agent/1.0",
    });
    const afterWrite = Date.now();

    const autoView = await configuredService.readConcept("proj-configured", "concepts/auto-stale");
    const autoStaleAfter = autoView.frontmatter?.stale_after;
    expect(typeof autoStaleAfter).toBe("string");
    const parsedAuto = typeof autoStaleAfter === "string" ? Date.parse(autoStaleAfter) : Number.NaN;
    expect(Number.isNaN(parsedAuto)).toBe(false);
    const expectedMin = beforeWrite + 30 * 86_400_000;
    const expectedMax = afterWrite + 30 * 86_400_000;
    expect(parsedAuto).toBeGreaterThanOrEqual(expectedMin - 2000);
    expect(parsedAuto).toBeLessThanOrEqual(expectedMax + 2000);
    expect(autoView.derived?.staleAfter).toBe(autoStaleAfter);
    expect(autoView.derived?.stale).toBe(false);

    // An explicit null is a producer value and is not replaced
    await configuredService.writeConcept(alice, {
      project: "proj-configured",
      id: "concepts/null-stale",
      frontmatter: { type: "Convention", title: "Null Stale Concept", stale_after: null },
      body: "Body content",
      actor: "agent/1.0",
    });
    const nullView = await configuredService.readConcept("proj-configured", "concepts/null-stale");
    expect(nullView.frontmatter?.stale_after).toBeNull();
    expect(nullView.derived?.staleAfter).toBeNull();

    // (b) an explicit stale_after is kept unchanged
    const explicitTimestamp = "2030-01-01T00:00:00Z";
    await configuredService.writeConcept(alice, {
      project: "proj-configured",
      id: "concepts/explicit-stale",
      frontmatter: { type: "Convention", title: "Explicit Stale Concept", stale_after: explicitTimestamp },
      body: "Body content",
      actor: "agent/1.0",
    });
    const explicitView = await configuredService.readConcept("proj-configured", "concepts/explicit-stale");
    expect(explicitView.frontmatter?.stale_after).toBe(explicitTimestamp);
    expect(explicitView.derived?.staleAfter).toBe(explicitTimestamp);

    // Caller's object is not mutated
    const originalFm = { type: "Convention", title: "Immutable Test" };
    await configuredService.writeConcept(alice, {
      project: "proj-configured",
      id: "concepts/immutable-test",
      frontmatter: originalFm,
      body: "Body content",
      actor: "agent/1.0",
    });
    expect("stale_after" in originalFm).toBe(false);

    // Updating a concept without stale_after when defaultStaleAfterDays is set stamps it
    await configuredService.writeConcept(alice, {
      project: "proj-configured",
      id: "concepts/explicit-stale",
      frontmatter: { type: "Convention", title: "Updated Concept Without Stale After" },
      body: "Updated body",
      actor: "agent/1.0",
      expectedRevision: explicitView.revision,
    });
    const updatedView = await configuredService.readConcept("proj-configured", "concepts/explicit-stale");
    expect(updatedView.frontmatter?.stale_after).not.toBe(explicitTimestamp);
    const updatedStaleAfter = updatedView.frontmatter?.stale_after;
    expect(typeof updatedStaleAfter).toBe("string");
    const parsedUpdated = typeof updatedStaleAfter === "string" ? Date.parse(updatedStaleAfter) : Number.NaN;
    expect(Number.isNaN(parsedUpdated)).toBe(false);

    // 2. (c) with it unset, no stale_after is added
    const { service: unconfiguredService } = await setupService();
    await unconfiguredService.createProject(alice, { project: "proj-unset", title: "Unset", actor: "human:alice" });

    await unconfiguredService.writeConcept(alice, {
      project: "proj-unset",
      id: "concepts/no-stale",
      frontmatter: { type: "Convention", title: "No Stale Concept" },
      body: "Body content",
      actor: "agent/1.0",
    });
    const unconfiguredView = await unconfiguredService.readConcept("proj-unset", "concepts/no-stale");
    expect(unconfiguredView.frontmatter?.stale_after).toBeUndefined();
    expect(unconfiguredView.derived?.staleAfter).toBeNull();
  });
});
