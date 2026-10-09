import { keepPreviousData, QueryClient, type UseQueryResult, useQuery } from "@tanstack/react-query";
import type { MetricsReport, MetricsWindow } from "../../../src/metrics/types.js";
import type { LintIssue } from "../../../src/okf/lint.js";
import type {
  ConceptView,
  IndexEntry,
  ProjectDetails,
  ProjectSummary,
} from "../../../src/service/knowledge-service.js";
import type { HistoryEntry, SyncStatus } from "../../../src/store/backend.js";
import type { SearchHit } from "../../../src/store/catalog.js";
import {
  ApiError,
  getIndex,
  getMetrics,
  getProject,
  history,
  lint,
  listProjects,
  readConcept,
  readFile,
  type SearchParams,
  search,
  syncStatus,
} from "./client.js";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.status < 500) {
          return false;
        }
        return failureCount < 2;
      },
    },
  },
});

export const queryKeys = {
  projects: () => ["projects"] as const,
  project: (p: string) => ["project", p] as const,
  index: (p: string, path: string) => ["index", p, path] as const,
  concept: (p: string, id: string) => ["concept", p, id] as const,
  file: (p: string, path: string) => ["file", p, path] as const,
  history: (p: string, id: string | null, limit: number) => ["history", p, id ?? null, limit] as const,
  lint: (p: string) => ["lint", p] as const,
  search: (params: SearchParams) => ["search", params] as const,
  sync: () => ["sync"] as const,
  metrics: (window: MetricsWindow) => ["metrics", window] as const,
};

export function useProjects(): UseQueryResult<ProjectSummary[], Error> {
  return useQuery({
    queryKey: queryKeys.projects(),
    queryFn: listProjects,
  });
}

export function useProject(p: string): UseQueryResult<ProjectDetails, Error> {
  return useQuery({
    queryKey: queryKeys.project(p),
    queryFn: () => getProject(p),
    enabled: Boolean(p),
  });
}

export function useIndex(p: string, path: string, enabled = true): UseQueryResult<IndexEntry[], Error> {
  return useQuery({
    queryKey: queryKeys.index(p, path),
    queryFn: () => getIndex(p, path),
    enabled: Boolean(p) && enabled,
  });
}

export function useConcept(p: string, id: string): UseQueryResult<ConceptView, Error> {
  return useQuery({
    queryKey: queryKeys.concept(p, id),
    queryFn: () => readConcept(p, id),
    enabled: Boolean(p && id),
  });
}

export function useFile(p: string, path: string): UseQueryResult<{ content: string; revision: string | null }, Error> {
  return useQuery({
    queryKey: queryKeys.file(p, path),
    queryFn: () => readFile(p, path),
    enabled: Boolean(p && path),
  });
}

export function useHistory(
  p: string,
  options?: { id?: string | null; limit?: number },
): UseQueryResult<HistoryEntry[], Error> {
  const id = options?.id ?? null;
  const limit = options?.limit ?? 20;
  return useQuery({
    queryKey: queryKeys.history(p, id, limit),
    queryFn: () => history(p, { id: id ?? undefined, limit }),
    enabled: Boolean(p),
  });
}

export function useLint(p: string): UseQueryResult<LintIssue[], Error> {
  return useQuery({
    queryKey: queryKeys.lint(p),
    queryFn: () => lint(p),
    enabled: Boolean(p),
  });
}

export function useSearch(params: SearchParams, enabled = true): UseQueryResult<SearchHit[], Error> {
  return useQuery({
    queryKey: queryKeys.search(params),
    queryFn: () => search(params),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useSyncStatus(): UseQueryResult<SyncStatus, Error> {
  return useQuery({
    queryKey: queryKeys.sync(),
    queryFn: syncStatus,
    refetchInterval: 60_000,
  });
}

export function useMetrics(window: MetricsWindow): UseQueryResult<MetricsReport, Error> {
  return useQuery({
    queryKey: queryKeys.metrics(window),
    queryFn: () => getMetrics(window),
    refetchInterval: 30_000,
    placeholderData: keepPreviousData,
  });
}
