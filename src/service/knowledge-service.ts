import { randomBytes } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { join, posix } from "node:path";
import type { Readable } from "node:stream";
import type { Document } from "yaml";
import type { Config, Logger } from "../config.js";
import { OkfError } from "../errors.js";
import {
  applyFrontmatter,
  appendVerification,
  nowIso,
  parseFrontmatter,
  serializeConcept,
  splitFrontmatter,
} from "../okf/frontmatter.js";
import { type ConceptRecord, parseConcept } from "../okf/concept.js";
import {
  blobRevision,
  normalizeConceptIdForWrite,
  normalizeFilePathForWrite,
  resolveReadPath,
  PROJECT_RE,
} from "../okf/paths.js";
import { type BundleTree, buildDirListing, lintBundle, planIndexes } from "../store/bundle.js";
import { extractBundleArchive } from "../store/archive.js";
import { fsBundleSource } from "../store/fs-util.js";
import type { Catalog, SearchParams, SearchHit } from "../store/catalog.js";
import {
  bundleSource,
  type HistoryEntry,
  type StorageBackend,
  type StorageTx,
  type SyncStatus,
} from "../store/backend.js";
import { type Principal, checkActor } from "./principal.js";
import {
  isStale,
  type Status,
  type TrustTier,
} from "../okf/semantics.js";
import {
  logCreationEntry,
  logDeletionEntry,
  logFileDeletionEntry,
  logFileUpdateEntry,
  logImportEntry,
  logInitializationEntry,
  logUpdateEntry,
  logVerificationEntry,
  prependLogEntry,
} from "../okf/log-file.js";
import { type LintIssue, lintConceptFile } from "../okf/lint.js";
import { normalizeRepository } from "../okf/repository.js";
import { renderIndex } from "../okf/index-file.js";

export interface ProjectSummary {
  project: string;
  title: string;
  description: string | null;
  conceptCount: number;
  staleCount: number;
  updatedAt: string | null;
  /** Normalized git remotes (`host/path`) from the overview's `repositories` frontmatter. */
  repositories: string[];
}

export interface ProjectDetails extends ProjectSummary {
  typeCounts: Record<string, number>;
  trustTierCounts: Record<TrustTier, number>;
}

export type IndexEntry =
  | { kind: "concept"; id: string; title: string; description: string | null; type: string | null }
  | { kind: "file"; path: string }
  | { kind: "directory"; path: string; conceptCount: number; fileCount: number };

export interface ConceptView {
  project: string;
  id: string;
  revision: string;
  markdown: string;
  frontmatter: Record<string, unknown> | null;
  body: string;
  derived: {
    title: string;
    type: string | null;
    description: string | null;
    tags: string[];
    status: Status;
    trustTier: TrustTier;
    stale: boolean;
    staleAfter: string | null;
    generatedAt: string | null;
    generatedBy: string | null;
    lastVerifiedAt: string | null;
  } | null;
  links: {
    outbound: Array<{ id: string; exists: boolean }>;
    inbound: string[];
  };
  issues: LintIssue[];
}

export interface WriteConceptResult {
  project: string;
  id: string;
  revision: string;
  created: boolean;
  commit: string | null;
  pushed: boolean | null;
  warnings: string[];
  ignoredKeys: string[];
  issues: LintIssue[];
}

export interface VerifyConceptResult {
  project: string;
  id: string;
  revision: string;
  trustTier: TrustTier;
  commit: string | null;
  pushed: boolean | null;
  warnings: string[];
}

export interface DeleteConceptResult {
  project: string;
  id: string;
  commit: string | null;
  pushed: boolean | null;
  warnings: string[];
  brokenInbound: string[];
}

export interface WriteFileResult {
  project: string;
  path: string;
  revision: string;
  commit: string | null;
  pushed: boolean | null;
  warnings: string[];
}

export interface DeleteFileResult {
  project: string;
  path: string;
  commit: string | null;
  pushed: boolean | null;
  warnings: string[];
}

export class KnowledgeService {
  readonly config: Config;
  readonly storage: StorageBackend;
  readonly catalog: Catalog;
  readonly log: Logger;

  constructor(opts: { config: Config; storage: StorageBackend; catalog: Catalog; log: Logger }) {
    this.config = opts.config;
    this.storage = opts.storage;
    this.catalog = opts.catalog;
    this.log = opts.log;

    this.storage.setResyncHandler(async (project, tx) => {
      const tree = await this.storage.tree(project);
      if (tree.isEmpty) {
        this.catalog.removeProject(project);
        return;
      }
      await this.catalog.rebuildProject(project, bundleSource(this.storage, project, tree));
      await this.regenerateIndexes(tx, project, "all");
    });
  }

  async initialize(): Promise<void> {
    const tmpDir = join(this.config.dataDir, "tmp");
    await rm(tmpDir, { recursive: true, force: true });
    await mkdir(tmpDir, { recursive: true });

    const projects = await this.storage.projects();
    for (const project of projects) {
      const tree = await this.storage.tree(project);
      await this.catalog.rebuildProject(project, bundleSource(this.storage, project, tree));
    }

    // Reconciliation: regenerate all indexes and ensure log.md; the transaction commits only on change.
    await this.storage.transaction({ projects }, async (tx) => {
      for (const project of projects) {
        await this.regenerateIndexes(tx, project, "all");
        if (!(await this.storage.tree(project)).hasFile("log.md")) {
          await tx.writeFile(project, "log.md", "# Update Log\n");
        }
      }
      return {
        value: undefined,
        commit: {
          subject: "okf: regenerate indexes",
          author: "process:ok-fine",
          principal: { subject: "system", clientId: "ok-fine" },
        },
      };
    });
  }

  /** Writes every index.md that differs from the planned content and deletes obsolete ones. */
  private async regenerateIndexes(tx: StorageTx, project: string, dirs: string[] | "all"): Promise<void> {
    const plan = planIndexes(await this.storage.tree(project), dirs, (id) => this.catalog.get(project, id));
    for (const { path, content } of plan) {
      if (content === null) {
        await tx.deleteFile(project, path);
      } else if ((await this.storage.readFile(project, path))?.toString("utf8") !== content) {
        await tx.writeFile(project, path, content);
      }
    }
  }

  private async prependLog(tx: StorageTx, project: string, entry: string): Promise<void> {
    const existing = (await this.storage.readFile(project, "log.md"))?.toString("utf8") ?? null;
    await tx.writeFile(project, "log.md", prependLogEntry(existing, nowIso().slice(0, 10), entry));
  }

  private async assertProjectExists(project: string, forWrite = false): Promise<BundleTree> {
    // Every project-scoped path is built from this name; PROJECT_RE forbids `.`, `..`, and `/`.
    if (!PROJECT_RE.test(project)) {
      throw new OkfError("invalid_id", 400, `invalid project name "${project}"`);
    }
    const tree = await this.storage.tree(project);
    if (tree.isEmpty) {
      const msg = forWrite ? "call create_project first" : `project "${project}" not found`;
      throw new OkfError("project_not_found", 404, msg);
    }
    return tree;
  }

  /** Normalized, deduplicated `repositories` from the project's overview frontmatter, in first-seen order. */
  private repositoriesOf(project: string): string[] {
    const raw = this.catalog.get(project, "overview")?.frontmatter?.repositories;
    const values = typeof raw === "string" ? [raw] : Array.isArray(raw) ? raw : [];
    const out: string[] = [];
    for (const value of values) {
      if (typeof value !== "string") continue;
      const normalized = normalizeRepository(value);
      if (normalized !== null && !out.includes(normalized)) out.push(normalized);
    }
    return out;
  }

  listProjects(filter: { repository?: string } = {}): { projects: ProjectSummary[] } {
    let wanted: string | null = null;
    if (filter.repository !== undefined) {
      wanted = normalizeRepository(filter.repository);
      if (wanted === null) {
        throw new OkfError(
          "bad_request",
          400,
          "repository must be a git remote URL such as git@github.com:org/repo.git or https://github.com/org/repo",
        );
      }
    }
    const projects = this.catalog.projects();
    const now = new Date();
    const summaries: ProjectSummary[] = [];

    for (const project of projects) {
      const records = this.catalog.records(project);
      const overview = this.catalog.get(project, "overview");

      let latestUpdatedAt: string | null = null;
      let staleCount = 0;

      for (const r of records) {
        if (isStale(r.frontmatter, now)) {
          staleCount++;
        }
        if (r.generatedAt) {
          if (!latestUpdatedAt || r.generatedAt > latestUpdatedAt) {
            latestUpdatedAt = r.generatedAt;
          }
        }
      }

      const repositories = this.repositoriesOf(project);
      if (wanted !== null && !repositories.includes(wanted)) continue;

      summaries.push({
        project,
        title: overview?.title ?? project,
        description: overview?.description ?? null,
        conceptCount: records.length,
        staleCount,
        updatedAt: latestUpdatedAt,
        repositories,
      });
    }

    return { projects: summaries };
  }

  async getProject(project: string): Promise<ProjectDetails> {
    await this.assertProjectExists(project);
    const records = this.catalog.records(project);
    const overview = this.catalog.get(project, "overview");
    const now = new Date();

    let latestUpdatedAt: string | null = null;
    let staleCount = 0;
    const typeCounts: Record<string, number> = {};
    const trustTierCounts: Record<TrustTier, number> = {
      unverified: 0,
      "machine-confirmed": 0,
      "human-reviewed": 0,
    };

    for (const r of records) {
      if (isStale(r.frontmatter, now)) {
        staleCount++;
      }
      if (r.generatedAt) {
        if (!latestUpdatedAt || r.generatedAt > latestUpdatedAt) {
          latestUpdatedAt = r.generatedAt;
        }
      }

      const tKey = r.type && r.type.length > 0 ? r.type : "Other";
      typeCounts[tKey] = (typeCounts[tKey] ?? 0) + 1;
      trustTierCounts[r.trustTier] = (trustTierCounts[r.trustTier] ?? 0) + 1;
    }

    return {
      project,
      title: overview?.title ?? project,
      description: overview?.description ?? null,
      conceptCount: records.length,
      staleCount,
      updatedAt: latestUpdatedAt,
      repositories: this.repositoriesOf(project),
      typeCounts,
      trustTierCounts,
    };
  }

  async getIndex(
    project: string,
    dir = ""
  ): Promise<{ project: string; path: string; markdown: string; entries: IndexEntry[] }> {
    const tree = await this.assertProjectExists(project);

    let cleanDir = "";
    if (dir && dir !== "/" && dir !== ".") {
      cleanDir = resolveReadPath(dir);
    }

    if (!tree.hasDir(cleanDir)) {
      throw new OkfError("not_found", 404, `directory "${dir}" not found in project "${project}"`);
    }

    const listing = buildDirListing(tree, cleanDir, (id) => this.catalog.get(project, id));
    const markdown = renderIndex(listing);

    const entries: IndexEntry[] = [];
    for (const c of listing.concepts) {
      const idWithoutMd = c.file.endsWith(".md") ? c.file.slice(0, -3) : c.file;
      const fullId = cleanDir === "" ? idWithoutMd : posix.join(cleanDir, idWithoutMd);
      entries.push({
        kind: "concept",
        id: fullId,
        title: c.title,
        description: c.description,
        type: c.type,
      });
    }

    for (const f of listing.files) {
      entries.push({
        kind: "file",
        path: cleanDir === "" ? f : posix.join(cleanDir, f),
      });
    }

    for (const d of listing.dirs) {
      entries.push({
        kind: "directory",
        path: cleanDir === "" ? d.name : posix.join(cleanDir, d.name),
        conceptCount: d.conceptCount,
        fileCount: d.fileCount,
      });
    }

    return {
      project,
      path: cleanDir,
      markdown,
      entries,
    };
  }

  async readConcept(project: string, id: string): Promise<ConceptView> {
    const tree = await this.assertProjectExists(project);
    let s = id;
    if (s.startsWith("/")) {
      s = s.slice(1);
    }
    if (s.endsWith(".md")) {
      s = s.slice(0, -3);
    }
    const cleanId = resolveReadPath(s);
    const buf = await this.storage.readFile(project, `${cleanId}.md`);
    if (buf === null) {
      throw new OkfError("not_found", 404, `concept "${cleanId}" not found in project "${project}"`);
    }

    const text = buf.toString("utf8");
    const revision = blobRevision(buf);

    const ctx = {
      now: new Date(),
      conceptExists: (targetId: string) => this.catalog.get(project, targetId) !== undefined,
      fileExists: (bundlePath: string) => tree.exists(bundlePath),
    };

    const issues = lintConceptFile(`${cleanId}.md`, text, ctx);
    const split = splitFrontmatter(text);

    if (!split) {
      return {
        project,
        id: cleanId,
        revision,
        markdown: text,
        frontmatter: null,
        body: text,
        derived: null,
        links: {
          outbound: [],
          inbound: this.catalog.inbound(project, cleanId),
        },
        issues,
      };
    }

    const parsed = parseFrontmatter(split.yaml);
    if ("error" in parsed) {
      return {
        project,
        id: cleanId,
        revision,
        markdown: text,
        frontmatter: null,
        body: split.body,
        derived: null,
        links: {
          outbound: [],
          inbound: this.catalog.inbound(project, cleanId),
        },
        issues,
      };
    }

    const record = parseConcept(project, cleanId, `${cleanId}.md`, buf);
    const derived = {
      title: record.title,
      type: record.type,
      description: record.description,
      tags: record.tags,
      status: record.status,
      trustTier: record.trustTier,
      stale: isStale(record.frontmatter, new Date()),
      staleAfter: record.staleAfter,
      generatedAt: record.generatedAt,
      generatedBy: record.generatedBy,
      lastVerifiedAt: record.lastVerifiedAt,
    };

    const outbound = record.outbound.map((target) => ({
      id: target,
      exists: this.catalog.get(project, target) !== undefined,
    }));

    return {
      project,
      id: cleanId,
      revision,
      markdown: text,
      frontmatter: record.frontmatter,
      body: record.body,
      derived,
      links: {
        outbound,
        inbound: this.catalog.inbound(project, cleanId),
      },
      issues,
    };
  }

  async search(params: SearchParams): Promise<{ results: SearchHit[] }> {
    if (params.project) {
      await this.assertProjectExists(params.project);
    }
    return { results: this.catalog.search(params) };
  }

  async history(
    project: string,
    id?: string,
    limit = 20
  ): Promise<{ commits: HistoryEntry[] }> {
    await this.assertProjectExists(project);

    let path: string | null = null;
    if (id) {
      let s = id;
      if (s.startsWith("/")) {
        s = s.slice(1);
      }
      if (s.endsWith(".md")) {
        s = s.slice(0, -3);
      }
      path = `${resolveReadPath(s)}.md`;
    }

    const commits = await this.storage.history(project, path, limit);
    return { commits };
  }

  async readFile(
    project: string,
    path: string
  ): Promise<{ project: string; path: string; revision: string; content: string }> {
    await this.assertProjectExists(project);
    const cleanPath = resolveReadPath(path);
    const buf = await this.storage.readFile(project, cleanPath);
    if (buf === null) {
      throw new OkfError("not_found", 404, `file "${cleanPath}" not found in project "${project}"`);
    }

    if (buf.length > this.config.maxFileBytes) {
      throw new OkfError("payload_too_large", 413, "file exceeds MAX_FILE_BYTES");
    }

    if (buf.includes(0)) {
      throw new OkfError(
        "unsupported_media",
        415,
        "binary files containing NUL bytes are not supported"
      );
    }

    return {
      project,
      path: cleanPath,
      revision: blobRevision(buf),
      content: buf.toString("utf8"),
    };
  }

  async lint(project: string): Promise<{ project: string; conformant: boolean; issues: LintIssue[] }> {
    const tree = await this.assertProjectExists(project);
    const res = await lintBundle(bundleSource(this.storage, project, tree), new Date());
    return {
      project,
      conformant: res.conformant,
      issues: res.issues,
    };
  }

  async createProject(
    p: Principal,
    args: { project: string; title: string; description?: string; actor: string }
  ): Promise<{ project: string; commit: string | null; pushed: boolean | null; warnings: string[] }> {
    checkActor(args.actor, p);

    if (!PROJECT_RE.test(args.project)) {
      throw new OkfError("invalid_id", 400, `invalid project name "${args.project}"`);
    }
    if (!args.title || args.title.trim().length === 0 || args.title.length > 200) {
      throw new OkfError("bad_request", 400, "project title must be between 1 and 200 characters");
    }

    if (!(await this.storage.tree(args.project)).isEmpty) {
      throw new OkfError("already_exists", 409, `project "${args.project}" already exists`);
    }

    const txRes = await this.storage.transaction({ projects: [args.project] }, async (tx) => {
      const overviewBody =
        args.description && args.description.trim().length > 0
          ? `# Overview\n\n${args.description.trim()}\n`
          : "# Overview\n";

      const fmInput: Record<string, unknown> = {
        type: "Project",
        title: args.title.trim(),
        status: "stable",
      };
      if (args.description && args.description.trim().length > 0) {
        fmInput.description = args.description.trim();
      }

      const fmRes = applyFrontmatter(null, fmInput, {
        generated: { by: args.actor, at: nowIso() },
      });
      const overviewContent = serializeConcept(fmRes.doc, overviewBody);
      await tx.writeFile(args.project, "overview.md", overviewContent);
      await this.prependLog(tx, args.project, logInitializationEntry(args.actor));

      const overviewBuf = Buffer.from(overviewContent, "utf8");
      this.catalog.upsert(parseConcept(args.project, "overview", "overview.md", overviewBuf));

      await this.regenerateIndexes(tx, args.project, [""]);

      return {
        value: { project: args.project },
        commit: {
          subject: `okf(${args.project}): create project`,
          author: args.actor,
          principal: { subject: p.subject, clientId: p.clientId },
        },
      };
    });

    return {
      project: args.project,
      commit: txRes.commit,
      pushed: txRes.pushed,
      warnings: txRes.warnings,
    };
  }

  async writeConcept(
    p: Principal,
    args: {
      project: string;
      id: string;
      frontmatter: Record<string, unknown>;
      body: string;
      actor: string;
      expectedRevision?: string | null;
      message?: string;
    }
  ): Promise<WriteConceptResult> {
    checkActor(args.actor, p);
    await this.assertProjectExists(args.project, true);
    const cleanId = normalizeConceptIdForWrite(args.id);

    if (
      !args.frontmatter ||
      typeof args.frontmatter !== "object" ||
      Array.isArray(args.frontmatter)
    ) {
      throw new OkfError("invalid_frontmatter", 400, "frontmatter must be a plain object");
    }
    if (typeof args.frontmatter.type !== "string" || args.frontmatter.type.trim().length === 0) {
      throw new OkfError(
        "invalid_frontmatter",
        400,
        "frontmatter must contain a non-blank string type"
      );
    }

    let resultPayload!: {
      revision: string;
      created: boolean;
      ignoredKeys: string[];
      issues: LintIssue[];
    };

    const txRes = await this.storage.transaction({ projects: [args.project] }, async (tx) => {
      const filePath = `${cleanId}.md`;
      let existingDoc: Document | null = null;
      let existingRev: string | null = null;
      let existingRecord: ConceptRecord | null = null;

      const existingBuf = await this.storage.readFile(args.project, filePath);
      if (existingBuf !== null) {
        existingRev = blobRevision(existingBuf);

        if (args.expectedRevision === null) {
          throw new OkfError("already_exists", 409, `concept "${cleanId}" already exists`);
        }
        if (typeof args.expectedRevision === "string" && args.expectedRevision !== existingRev) {
          throw new OkfError("revision_conflict", 409, "revision conflict", {
            currentRevision: existingRev,
          });
        }

        const existingSplit = splitFrontmatter(existingBuf.toString("utf8"));
        if (existingSplit) {
          const parsed = parseFrontmatter(existingSplit.yaml);
          if ("doc" in parsed) {
            existingDoc = parsed.doc;
          }
        }
        existingRecord = this.catalog.get(args.project, cleanId) ?? null;
      } else {
        if (typeof args.expectedRevision === "string") {
          throw new OkfError("revision_conflict", 409, "concept does not exist", {
            currentRevision: null,
          });
        }
      }

      const isCreated = existingRev === null;
      const prevStatus = existingRecord?.status;

      const { doc, ignoredKeys } = applyFrontmatter(existingDoc, args.frontmatter, {
        generated: { by: args.actor, at: nowIso() },
      });

      const newContent = serializeConcept(doc, args.body);
      const newBuf = Buffer.from(newContent, "utf8");

      if (newBuf.length > this.config.maxFileBytes) {
        throw new OkfError("payload_too_large", 413, "concept exceeds MAX_FILE_BYTES");
      }

      await tx.writeFile(args.project, filePath, newBuf);
      const newRev = blobRevision(newBuf);

      const newRecord = parseConcept(args.project, cleanId, filePath, newBuf);
      this.catalog.upsert(newRecord);

      const touchedDir = posix.dirname(cleanId) === "." ? "" : posix.dirname(cleanId);
      await this.regenerateIndexes(tx, args.project, [touchedDir]);

      let logText: string;
      const title = newRecord.title;
      if (isCreated) {
        logText = logCreationEntry(title, cleanId, args.actor, args.message);
      } else {
        const isDeprecating = newRecord.status === "deprecated" && prevStatus !== "deprecated";
        logText = logUpdateEntry(title, cleanId, args.actor, isDeprecating, args.message);
      }
      await this.prependLog(tx, args.project, logText);

      const tree = await this.storage.tree(args.project);

      const issues = lintConceptFile(`${cleanId}.md`, newContent, {
        now: new Date(),
        conceptExists: (id: string) => this.catalog.get(args.project, id) !== undefined,
        fileExists: (bundlePath: string) => tree.exists(bundlePath),
      });

      resultPayload = {
        revision: newRev,
        created: isCreated,
        ignoredKeys,
        issues,
      };

      const subject = isCreated
        ? `okf(${args.project}): create ${cleanId}`
        : `okf(${args.project}): update ${cleanId}`;

      return {
        value: resultPayload,
        commit: {
          subject,
          body: args.message,
          author: args.actor,
          principal: { subject: p.subject, clientId: p.clientId },
        },
      };
    });

    return {
      project: args.project,
      id: cleanId,
      revision: resultPayload.revision,
      created: resultPayload.created,
      commit: txRes.commit,
      pushed: txRes.pushed,
      warnings: txRes.warnings,
      ignoredKeys: resultPayload.ignoredKeys,
      issues: resultPayload.issues,
    };
  }

  async verifyConcept(
    p: Principal,
    args: { project: string; id: string; actor: string; expectedRevision?: string }
  ): Promise<VerifyConceptResult> {
    checkActor(args.actor, p);
    await this.assertProjectExists(args.project, true);

    let s = args.id;
    if (s.startsWith("/")) {
      s = s.slice(1);
    }
    if (s.endsWith(".md")) {
      s = s.slice(0, -3);
    }
    const cleanId = resolveReadPath(s);
    const filePath = `${cleanId}.md`;

    let newTrustTier!: TrustTier;
    let newRev!: string;

    const txRes = await this.storage.transaction({ projects: [args.project] }, async (tx) => {
      const buf = await this.storage.readFile(args.project, filePath);
      if (buf === null) {
        throw new OkfError(
          "not_found",
          404,
          `concept "${cleanId}" not found in project "${args.project}"`
        );
      }

      const currentRev = blobRevision(buf);

      if (args.expectedRevision && args.expectedRevision !== currentRev) {
        throw new OkfError("revision_conflict", 409, "revision conflict", {
          currentRevision: currentRev,
        });
      }

      const text = buf.toString("utf8");
      const split = splitFrontmatter(text);
      if (!split) {
        throw new OkfError(
          "invalid_frontmatter",
          400,
          "cannot verify an unparseable concept: missing frontmatter"
        );
      }

      const parsed = parseFrontmatter(split.yaml);
      if ("error" in parsed) {
        throw new OkfError(
          "invalid_frontmatter",
          400,
          `cannot verify an unparseable concept: ${parsed.message}`
        );
      }

      appendVerification(parsed.doc, { by: args.actor, at: nowIso() });
      const newContent = serializeConcept(parsed.doc, split.body);
      const newBuf = Buffer.from(newContent, "utf8");

      await tx.writeFile(args.project, filePath, newBuf);
      newRev = blobRevision(newBuf);

      const newRecord = parseConcept(args.project, cleanId, filePath, newBuf);
      this.catalog.upsert(newRecord);
      newTrustTier = newRecord.trustTier;

      await this.prependLog(tx, args.project, logVerificationEntry(newRecord.title, cleanId, args.actor));

      return {
        value: { revision: newRev, trustTier: newTrustTier },
        commit: {
          subject: `okf(${args.project}): verify ${cleanId}`,
          author: args.actor,
          principal: { subject: p.subject, clientId: p.clientId },
        },
      };
    });

    return {
      project: args.project,
      id: cleanId,
      revision: newRev,
      trustTier: newTrustTier,
      commit: txRes.commit,
      pushed: txRes.pushed,
      warnings: txRes.warnings,
    };
  }

  async deleteConcept(
    p: Principal,
    args: { project: string; id: string; actor: string; expectedRevision?: string }
  ): Promise<DeleteConceptResult> {
    checkActor(args.actor, p);
    await this.assertProjectExists(args.project, true);

    let s = args.id;
    if (s.startsWith("/")) {
      s = s.slice(1);
    }
    if (s.endsWith(".md")) {
      s = s.slice(0, -3);
    }
    const cleanId = resolveReadPath(s);
    const filePath = `${cleanId}.md`;

    let brokenInbound: string[] = [];

    const txRes = await this.storage.transaction({ projects: [args.project] }, async (tx) => {
      const buf = await this.storage.readFile(args.project, filePath);
      if (buf === null) {
        throw new OkfError(
          "not_found",
          404,
          `concept "${cleanId}" not found in project "${args.project}"`
        );
      }

      const currentRev = blobRevision(buf);

      if (args.expectedRevision && args.expectedRevision !== currentRev) {
        throw new OkfError("revision_conflict", 409, "revision conflict", {
          currentRevision: currentRev,
        });
      }

      brokenInbound = this.catalog.inbound(args.project, cleanId);

      await tx.deleteFile(args.project, filePath);
      this.catalog.remove(args.project, cleanId);

      const touchedDir = posix.dirname(cleanId) === "." ? "" : posix.dirname(cleanId);
      await this.regenerateIndexes(tx, args.project, [touchedDir]);
      await this.prependLog(tx, args.project, logDeletionEntry(cleanId, args.actor));

      return {
        value: { brokenInbound },
        commit: {
          subject: `okf(${args.project}): delete ${cleanId}`,
          author: args.actor,
          principal: { subject: p.subject, clientId: p.clientId },
        },
      };
    });

    return {
      project: args.project,
      id: cleanId,
      commit: txRes.commit,
      pushed: txRes.pushed,
      warnings: txRes.warnings,
      brokenInbound,
    };
  }

  async writeFile(
    p: Principal,
    args: {
      project: string;
      path: string;
      content: string | Buffer;
      actor: string;
      expectedRevision?: string | null;
    }
  ): Promise<WriteFileResult> {
    checkActor(args.actor, p);
    await this.assertProjectExists(args.project, true);
    const cleanPath = normalizeFilePathForWrite(args.path);

    let newRev!: string;

    const txRes = await this.storage.transaction({ projects: [args.project] }, async (tx) => {
      const dataBuf = Buffer.isBuffer(args.content)
        ? args.content
        : Buffer.from(args.content, "utf8");

      if (dataBuf.length > this.config.maxFileBytes) {
        throw new OkfError("payload_too_large", 413, "file exceeds MAX_FILE_BYTES");
      }

      const existingBuf = await this.storage.readFile(args.project, cleanPath);
      if (existingBuf !== null) {
        const currentRev = blobRevision(existingBuf);
        if (args.expectedRevision === null) {
          throw new OkfError("already_exists", 409, `file "${cleanPath}" already exists`);
        }
        if (typeof args.expectedRevision === "string" && args.expectedRevision !== currentRev) {
          throw new OkfError("revision_conflict", 409, "revision conflict", {
            currentRevision: currentRev,
          });
        }
      } else {
        if (typeof args.expectedRevision === "string") {
          throw new OkfError("revision_conflict", 409, "file does not exist", {
            currentRevision: null,
          });
        }
      }

      await tx.writeFile(args.project, cleanPath, dataBuf);
      newRev = blobRevision(dataBuf);

      const touchedDir = posix.dirname(cleanPath) === "." ? "" : posix.dirname(cleanPath);
      await this.regenerateIndexes(tx, args.project, [touchedDir]);
      await this.prependLog(tx, args.project, logFileUpdateEntry(cleanPath, args.actor));

      return {
        value: { revision: newRev },
        commit: {
          subject: `okf(${args.project}): write file ${cleanPath}`,
          author: args.actor,
          principal: { subject: p.subject, clientId: p.clientId },
        },
      };
    });

    return {
      project: args.project,
      path: cleanPath,
      revision: newRev,
      commit: txRes.commit,
      pushed: txRes.pushed,
      warnings: txRes.warnings,
    };
  }

  async deleteFile(
    p: Principal,
    args: { project: string; path: string; actor: string; expectedRevision?: string | null }
  ): Promise<DeleteFileResult> {
    checkActor(args.actor, p);
    await this.assertProjectExists(args.project, true);
    const cleanPath = normalizeFilePathForWrite(args.path);

    const txRes = await this.storage.transaction({ projects: [args.project] }, async (tx) => {
      const existingBuf = await this.storage.readFile(args.project, cleanPath);
      if (existingBuf === null) {
        throw new OkfError(
          "not_found",
          404,
          `file "${cleanPath}" not found in project "${args.project}"`
        );
      }

      const currentRev = blobRevision(existingBuf);
      if (args.expectedRevision === null) {
        throw new OkfError("revision_conflict", 409, "file exists but null expected", {
          currentRevision: currentRev,
        });
      }
      if (typeof args.expectedRevision === "string" && args.expectedRevision !== currentRev) {
        throw new OkfError("revision_conflict", 409, "revision conflict", {
          currentRevision: currentRev,
        });
      }

      await tx.deleteFile(args.project, cleanPath);

      const touchedDir = posix.dirname(cleanPath) === "." ? "" : posix.dirname(cleanPath);
      await this.regenerateIndexes(tx, args.project, [touchedDir]);
      await this.prependLog(tx, args.project, logFileDeletionEntry(cleanPath, args.actor));

      return {
        value: null,
        commit: {
          subject: `okf(${args.project}): delete file ${cleanPath}`,
          author: args.actor,
          principal: { subject: p.subject, clientId: p.clientId },
        },
      };
    });

    return {
      project: args.project,
      path: cleanPath,
      commit: txRes.commit,
      pushed: txRes.pushed,
      warnings: txRes.warnings,
    };
  }

  async deleteProject(
    p: Principal,
    args: { project: string; actor: string }
  ): Promise<{ project: string; commit: string | null; pushed: boolean | null; warnings: string[] }> {
    checkActor(args.actor, p);
    await this.assertProjectExists(args.project, true);

    const txRes = await this.storage.transaction({ projects: [args.project] }, async (tx) => {
      await tx.deleteProject(args.project);
      this.catalog.removeProject(args.project);

      return {
        value: null,
        commit: {
          subject: `okf(${args.project}): delete project`,
          author: args.actor,
          principal: { subject: p.subject, clientId: p.clientId },
        },
      };
    });

    return {
      project: args.project,
      commit: txRes.commit,
      pushed: txRes.pushed,
      warnings: txRes.warnings,
    };
  }

  exportArchive(project: string): Readable {
    if (!PROJECT_RE.test(project) || !this.catalog.projects().includes(project)) {
      throw new OkfError("project_not_found", 404, `project "${project}" not found`);
    }
    return this.storage.archive(project);
  }

  async importArchive(
    p: Principal,
    args: { project: string; actor: string; archive: Buffer }
  ): Promise<{
    project: string;
    conceptCount: number;
    commit: string | null;
    pushed: boolean | null;
    warnings: string[];
  }> {
    checkActor(args.actor, p);

    if (!PROJECT_RE.test(args.project)) {
      throw new OkfError("invalid_id", 400, `invalid project name "${args.project}"`);
    }

    if (args.archive.length > this.config.maxArchiveBytes) {
      throw new OkfError(
        "payload_too_large",
        413,
        `archive size (${args.archive.length}) exceeds MAX_ARCHIVE_BYTES (${this.config.maxArchiveBytes})`
      );
    }

    const randomSuffix = randomBytes(6).toString("hex");
    const stagingDir = join(this.config.dataDir, "tmp", `import-${randomSuffix}`);
    await mkdir(stagingDir, { recursive: true });

    try {
      await extractBundleArchive(args.archive, stagingDir, {
        maxFileBytes: this.config.maxFileBytes,
        maxArchiveBytes: this.config.maxArchiveBytes,
      });

      const staged = await fsBundleSource(stagingDir);
      const lintRes = await lintBundle(staged, new Date());
      const fatalErrors = lintRes.issues.filter(
        (i) =>
          i.severity === "error" &&
          i.code !== "index_frontmatter" &&
          i.code !== "index_no_sections"
      );

      if (fatalErrors.length > 0) {
        throw new OkfError("bundle_not_conformant", 422, "bundle is not OKF-conformant", {
          issues: lintRes.issues,
        });
      }

      let conceptCount = 0;

      const txRes = await this.storage.transaction({ projects: [args.project] }, async (tx) => {
        await tx.replaceProject(args.project, staged);
        await this.catalog.rebuildProject(args.project, staged);
        await this.regenerateIndexes(tx, args.project, "all");
        await this.prependLog(tx, args.project, logImportEntry(args.actor));

        conceptCount = this.catalog.records(args.project).length;

        return {
          value: null,
          commit: {
            subject: `okf(${args.project}): import archive`,
            author: args.actor,
            principal: { subject: p.subject, clientId: p.clientId },
          },
        };
      });

      return {
        project: args.project,
        conceptCount,
        commit: txRes.commit,
        pushed: txRes.pushed,
        warnings: txRes.warnings,
      };
    } finally {
      await rm(stagingDir, { recursive: true, force: true });
    }
  }

  async syncNow(): Promise<SyncStatus> {
    return this.storage.sync();
  }

  async syncStatus(): Promise<SyncStatus> {
    return this.storage.syncStatus();
  }
}
