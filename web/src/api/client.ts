import type { UiClientConfig } from "../../../src/http/ui.js";
import type { MetricsReport, MetricsWindow } from "../../../src/metrics/types.js";
import type { LintIssue } from "../../../src/okf/lint.js";
import type { Status, TrustTier } from "../../../src/okf/semantics.js";
import type {
  ConceptView,
  IndexEntry,
  ProjectDetails,
  ProjectSummary,
} from "../../../src/service/knowledge-service.js";
import type { HistoryEntry, SyncStatus } from "../../../src/store/backend.js";
import type { SearchHit } from "../../../src/store/catalog.js";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export interface AuthHooks {
  getToken(): string | null;
  onUnauthorized(): void;
  onForbidden(): void;
}

let authHooks: AuthHooks = {
  getToken: () => null,
  onUnauthorized: () => {},
  onForbidden: () => {},
};

export function setAuthHooks(hooks: AuthHooks): void {
  authHooks = hooks;
}

export interface SearchParams {
  q?: string;
  project?: string;
  type?: string;
  tag?: string[];
  status?: Status;
  trustTier?: TrustTier;
  stale?: boolean;
  limit?: number;
}

export type { Status, TrustTier };

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  const token = authHooks.getToken();
  if (token && !headers.has("authorization")) {
    headers.set("authorization", `Bearer ${token}`);
  }

  const url = path.startsWith("/") || /^https?:\/\//i.test(path) ? path : `/${path}`;
  const res = await fetch(url, {
    ...init,
    headers,
  });

  if (!res.ok) {
    if (res.status === 401) {
      authHooks.onUnauthorized();
      throw new ApiError(401, "unauthorized", "unauthorized");
    }

    if (res.status === 403) {
      const wwwAuth = res.headers.get("www-authenticate") ?? "";
      if (wwwAuth.includes("insufficient_scope")) {
        authHooks.onForbidden();
        throw new ApiError(403, "insufficient_scope", "insufficient scope");
      }
    }

    let code = `http_${res.status}`;
    let message = res.statusText || `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } };
      if (body?.error) {
        if (typeof body.error.code === "string") code = body.error.code;
        if (typeof body.error.message === "string") message = body.error.message;
      }
    } catch {
      // Non-JSON response, keep defaults
    }

    throw new ApiError(res.status, code, message);
  }

  return res;
}

export async function getUiConfig(): Promise<UiClientConfig> {
  const res = await fetch("/ui/config.json");
  if (!res.ok) {
    let code = `http_${res.status}`;
    let message = res.statusText || `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } };
      if (body?.error?.code) code = body.error.code;
      if (body?.error?.message) message = body.error.message;
    } catch {
      // Non-JSON response, keep defaults
    }
    throw new ApiError(res.status, code, message);
  }
  return (await res.json()) as UiClientConfig;
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const res = await apiFetch("/api/v1/projects");
  const data = (await res.json()) as { projects: ProjectSummary[] };
  return data.projects;
}

export async function getProject(p: string): Promise<ProjectDetails> {
  const res = await apiFetch(`/api/v1/projects/${encodeURIComponent(p)}`);
  return (await res.json()) as ProjectDetails;
}

export async function getIndex(p: string, path: string): Promise<IndexEntry[]> {
  const query = path ? `?path=${encodeURIComponent(path)}` : "";
  const res = await apiFetch(`/api/v1/projects/${encodeURIComponent(p)}/index${query}`);
  const data = (await res.json()) as { entries: IndexEntry[] };
  return data.entries;
}

export async function readConcept(p: string, id: string): Promise<ConceptView> {
  const normalizedId = id.startsWith("/") ? id.slice(1) : id;
  const encodedId = normalizedId.split("/").map(encodeURIComponent).join("/");
  const res = await apiFetch(`/api/v1/projects/${encodeURIComponent(p)}/concepts/${encodedId}`, {
    headers: { accept: "application/json" },
  });
  return (await res.json()) as ConceptView;
}

export async function readFile(p: string, path: string): Promise<{ content: string; revision: string | null }> {
  const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
  const encodedPath = normalizedPath.split("/").map(encodeURIComponent).join("/");
  const res = await apiFetch(`/api/v1/projects/${encodeURIComponent(p)}/files/${encodedPath}`);
  const content = await res.text();
  const rawEtag = res.headers.get("etag");
  let revision: string | null = null;
  if (rawEtag) {
    const stripped = rawEtag.replace(/^W\//, "").replace(/^"|"$/g, "");
    revision = stripped.length > 0 ? stripped : null;
  }
  return { content, revision };
}

export async function history(p: string, options?: { id?: string; limit?: number }): Promise<HistoryEntry[]> {
  const params = new URLSearchParams();
  if (options?.id) {
    params.set("id", options.id);
  }
  if (options?.limit !== undefined) {
    params.set("limit", String(options.limit));
  }
  const qs = params.toString();
  const res = await apiFetch(`/api/v1/projects/${encodeURIComponent(p)}/history${qs ? `?${qs}` : ""}`);
  const data = (await res.json()) as { commits: HistoryEntry[] };
  return data.commits;
}

export async function lint(p: string): Promise<LintIssue[]> {
  const res = await apiFetch(`/api/v1/projects/${encodeURIComponent(p)}/lint`);
  const data = (await res.json()) as { issues: LintIssue[] };
  return data.issues;
}

export async function search(params: SearchParams): Promise<SearchHit[]> {
  const qp = new URLSearchParams();
  if (params.q !== undefined && params.q.trim() !== "") {
    qp.set("q", params.q.trim());
  }
  if (params.project) {
    qp.set("project", params.project);
  }
  if (params.type) {
    qp.set("type", params.type);
  }
  if (params.tag && params.tag.length > 0) {
    for (const t of params.tag) {
      if (t) qp.append("tag", t);
    }
  }
  if (params.status) {
    qp.set("status", params.status);
  }
  if (params.trustTier) {
    qp.set("trustTier", params.trustTier);
  }
  if (typeof params.stale === "boolean") {
    qp.set("stale", params.stale ? "true" : "false");
  }
  if (typeof params.limit === "number") {
    qp.set("limit", String(params.limit));
  }
  const qs = qp.toString();
  const res = await apiFetch(`/api/v1/search${qs ? `?${qs}` : ""}`);
  const data = (await res.json()) as { results: SearchHit[] };
  return data.results;
}

export async function syncStatus(): Promise<SyncStatus> {
  const res = await apiFetch("/api/v1/sync");
  return (await res.json()) as SyncStatus;
}

export async function getMetrics(window: MetricsWindow): Promise<MetricsReport> {
  const res = await apiFetch(`/api/v1/metrics?window=${window}`);
  return (await res.json()) as MetricsReport;
}

export async function downloadArchive(p: string): Promise<void> {
  const res = await apiFetch(`/api/v1/projects/${encodeURIComponent(p)}/archive`);
  const blob = await res.blob();
  if (typeof window !== "undefined" && typeof document !== "undefined" && typeof URL.createObjectURL === "function") {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${p}.tar.gz`;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}
