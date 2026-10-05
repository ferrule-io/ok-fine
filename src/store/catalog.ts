import MiniSearch from "minisearch";
import { type ConceptRecord, parseConcept } from "../okf/concept.js";
import { isStale, type Status, type TrustTier } from "../okf/semantics.js";
import type { BundleSource } from "./backend.js";
import { isConceptPath } from "./bundle.js";

export interface SearchParams {
  query?: string;
  project?: string;
  type?: string;
  tags?: string[];
  status?: Status;
  trustTier?: TrustTier;
  stale?: boolean;
  limit?: number;
}

export interface SearchHit {
  project: string;
  id: string;
  title: string;
  description: string | null;
  type: string | null;
  tags: string[];
  status: Status;
  trustTier: TrustTier;
  stale: boolean;
  score: number | null;
  snippet: string | null;
}

interface IndexedDoc {
  key: string;
  project: string;
  id: string;
  idText: string;
  title: string;
  description: string;
  tags: string;
  type: string;
  body: string;
}

function tierRank(tier: TrustTier): number {
  if (tier === "human-reviewed") return 3;
  if (tier === "machine-confirmed") return 2;
  return 1;
}

function extractSnippet(body: string, terms: string[], description: string | null): string | null {
  if (terms.length > 0) {
    const lowerTerms = terms.map((t) => t.toLowerCase()).filter((t) => t.length > 0);
    const lines = body.split(/\r?\n/);
    let inCode = false;
    for (const rawLine of lines) {
      const trimmed = rawLine.trim();
      if (trimmed.startsWith("```")) {
        inCode = !inCode;
        continue;
      }
      if (inCode || trimmed.startsWith("#") || trimmed.length === 0) {
        continue;
      }
      const lowerLine = trimmed.toLowerCase();
      if (lowerTerms.some((t) => lowerLine.includes(t))) {
        if (trimmed.length > 240) {
          return `${trimmed.slice(0, 240)}…`;
        }
        return trimmed;
      }
    }
  }
  return description ?? null;
}

export class Catalog {
  private readonly miniSearch: MiniSearch<IndexedDoc>;
  // project -> (id -> ConceptRecord)
  private readonly projectRecords = new Map<string, Map<string, ConceptRecord>>();
  // project -> (targetId -> Set<sourceId>)
  private readonly inboundLinks = new Map<string, Map<string, Set<string>>>();

  constructor() {
    this.miniSearch = new MiniSearch<IndexedDoc>({
      idField: "key",
      fields: ["title", "description", "tags", "type", "idText", "body"],
      storeFields: ["project", "id"],
      searchOptions: {
        boost: { title: 3, description: 2, tags: 2, idText: 1.5, type: 1, body: 1 },
        prefix: (t) => t.length >= 3,
        fuzzy: (t) => (t.length >= 5 ? 0.2 : 0),
      },
    });
  }

  async rebuildProject(project: string, source: BundleSource): Promise<void> {
    this.removeProject(project);

    for (const file of source.paths) {
      if (!isConceptPath(file)) {
        continue;
      }
      try {
        const buf = await source.read(file);
        if (buf === null) {
          continue;
        }
        const id = file.endsWith(".md") ? file.slice(0, -3) : file;
        this.storeRecord(parseConcept(project, id, file, buf));
      } catch {
        // ignore unreadable file during rebuild
      }
    }
  }

  removeProject(project: string): void {
    const pMap = this.projectRecords.get(project);
    if (pMap) {
      for (const id of pMap.keys()) {
        const key = `${project}/${id}`;
        if (this.miniSearch.has(key)) {
          this.miniSearch.discard(key);
        }
      }
      this.projectRecords.delete(project);
    }
    this.inboundLinks.delete(project);
  }

  upsert(record: ConceptRecord): void {
    this.storeRecord(record);
  }

  private storeRecord(record: ConceptRecord): void {
    const { project, id } = record;

    let pMap = this.projectRecords.get(project);
    if (!pMap) {
      pMap = new Map();
      this.projectRecords.set(project, pMap);
    }

    let pInbound = this.inboundLinks.get(project);
    if (!pInbound) {
      pInbound = new Map();
      this.inboundLinks.set(project, pInbound);
    }

    const prev = pMap.get(id);
    if (prev) {
      for (const target of prev.outbound) {
        pInbound.get(target)?.delete(id);
      }
    }

    pMap.set(id, record);

    for (const target of record.outbound) {
      let sources = pInbound.get(target);
      if (!sources) {
        sources = new Set();
        pInbound.set(target, sources);
      }
      sources.add(id);
    }

    const key = `${project}/${id}`;
    if (record.parseError) {
      if (this.miniSearch.has(key)) {
        this.miniSearch.discard(key);
      }
    } else {
      const doc: IndexedDoc = {
        key,
        project,
        id,
        idText: id.replace(/[/\-_]/g, " "),
        title: record.title,
        description: record.description ?? "",
        tags: record.tags.join(" "),
        type: record.type ?? "",
        body: record.body,
      };

      if (this.miniSearch.has(key)) {
        this.miniSearch.replace(doc);
      } else {
        this.miniSearch.add(doc);
      }
    }
  }

  remove(project: string, id: string): void {
    const pMap = this.projectRecords.get(project);
    if (pMap) {
      const prev = pMap.get(id);
      if (prev) {
        const pInbound = this.inboundLinks.get(project);
        if (pInbound) {
          for (const target of prev.outbound) {
            pInbound.get(target)?.delete(id);
          }
        }
      }
      pMap.delete(id);
    }

    const key = `${project}/${id}`;
    if (this.miniSearch.has(key)) {
      this.miniSearch.discard(key);
    }
  }

  get(project: string, id: string): ConceptRecord | undefined {
    return this.projectRecords.get(project)?.get(id);
  }

  records(project: string): ConceptRecord[] {
    const pMap = this.projectRecords.get(project);
    return pMap ? Array.from(pMap.values()) : [];
  }

  projects(): string[] {
    return Array.from(this.projectRecords.keys()).sort((a, b) => a.localeCompare(b, "en"));
  }

  inbound(project: string, id: string): string[] {
    const sources = this.inboundLinks.get(project)?.get(id);
    if (!sources || sources.size === 0) {
      return [];
    }
    return Array.from(sources).sort((a, b) => a.localeCompare(b, "en"));
  }

  search(params: SearchParams): SearchHit[] {
    const limit = Math.max(1, Math.min(100, params.limit ?? 20));
    const now = new Date();

    const matchesFilter = (record: ConceptRecord): boolean => {
      if (record.parseError) {
        return false;
      }
      if (params.project && record.project !== params.project) {
        return false;
      }
      if (params.type && record.type?.toLowerCase() !== params.type.toLowerCase()) {
        return false;
      }
      if (params.tags && params.tags.length > 0) {
        const lowerRecordTags = record.tags.map((t) => t.toLowerCase());
        const hasAllTags = params.tags.every((t) => lowerRecordTags.includes(t.toLowerCase()));
        if (!hasAllTags) {
          return false;
        }
      }
      if (params.status != null) {
        if (record.status !== params.status) {
          return false;
        }
      } else {
        // If status is omitted, exclude deprecated
        if (record.status === "deprecated") {
          return false;
        }
      }
      if (params.trustTier != null && record.trustTier !== params.trustTier) {
        return false;
      }
      if (params.stale !== undefined) {
        const staleState = isStale(record.frontmatter, now);
        if (staleState !== params.stale) {
          return false;
        }
      }
      return true;
    };

    const q = params.query?.trim() ?? "";

    if (q.length > 0) {
      const rawHits = this.miniSearch.search(q);
      const results: SearchHit[] = [];

      for (const hit of rawHits) {
        const record = this.get(hit.project, hit.id);
        if (!record || !matchesFilter(record)) {
          continue;
        }
        const snippet = extractSnippet(record.body, hit.terms, record.description);
        results.push({
          project: record.project,
          id: record.id,
          title: record.title,
          description: record.description,
          type: record.type,
          tags: record.tags,
          status: record.status,
          trustTier: record.trustTier,
          stale: isStale(record.frontmatter, now),
          score: hit.score,
          snippet,
        });
      }

      results.sort((a, b) => {
        const scoreDiff = (b.score ?? 0) - (a.score ?? 0);
        if (Math.abs(scoreDiff) > 1e-9) {
          return scoreDiff;
        }
        const tierDiff = tierRank(b.trustTier) - tierRank(a.trustTier);
        if (tierDiff !== 0) {
          return tierDiff;
        }
        const keyA = `${a.project}/${a.id}`;
        const keyB = `${b.project}/${b.id}`;
        return keyA.localeCompare(keyB, "en");
      });

      return results.slice(0, limit);
    } else {
      const results: SearchHit[] = [];
      const projectList = params.project ? [params.project] : this.projects();

      for (const p of projectList) {
        const pRecords = this.records(p);
        for (const record of pRecords) {
          if (!matchesFilter(record)) {
            continue;
          }
          results.push({
            project: record.project,
            id: record.id,
            title: record.title,
            description: record.description,
            type: record.type,
            tags: record.tags,
            status: record.status,
            trustTier: record.trustTier,
            stale: isStale(record.frontmatter, now),
            score: null,
            snippet: record.description,
          });
        }
      }

      results.sort((a, b) => {
        const pDiff = a.project.localeCompare(b.project, "en");
        if (pDiff !== 0) {
          return pDiff;
        }
        return a.id.localeCompare(b.id, "en");
      });

      return results.slice(0, limit);
    }
  }
}
