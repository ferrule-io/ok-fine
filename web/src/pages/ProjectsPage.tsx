import { clsx } from "clsx";
import { Clock, FileText, FolderKanban, GitBranch, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useProjects } from "../api/queries.js";
import { EmptyState } from "../components/EmptyState.js";
import { ErrorState } from "../components/ErrorState.js";
import { Page } from "../components/Page.js";
import { Skeleton } from "../components/Skeleton.js";
import { relativeTime } from "../lib/format.js";

export function ProjectsPage() {
  const { data: projects, isLoading, isError, error, refetch } = useProjects();
  const [filter, setFilter] = useState("");

  const totalConcepts = useMemo(() => {
    if (!projects) return 0;
    return projects.reduce((sum, p) => sum + p.conceptCount, 0);
  }, [projects]);

  const filteredAndSorted = useMemo(() => {
    if (!projects) return [];
    const query = filter.trim().toLowerCase();
    const matching = query
      ? projects.filter(
          (p) =>
            p.title.toLowerCase().includes(query) ||
            p.project.toLowerCase().includes(query) ||
            Boolean(p.description?.toLowerCase().includes(query)),
        )
      : projects;

    return [...matching].sort((a, b) => {
      if (!a.updatedAt && !b.updatedAt) return 0;
      if (!a.updatedAt) return 1;
      if (!b.updatedAt) return -1;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }, [projects, filter]);

  if (isLoading) {
    return (
      <Page title="Projects" className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-9 w-64 rounded-lg" />
          <Skeleton className="h-5 w-48 rounded-md" />
        </div>
        <div className="mt-6">
          <Skeleton className="h-10 w-full max-w-sm rounded-lg" />
        </div>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: skeleton items
            <div key={i} className="flex flex-col justify-between rounded-xl border border-border bg-surface p-5">
              <div>
                <div className="flex items-center justify-between gap-2">
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-4 w-20" />
                </div>
                <div className="mt-3 space-y-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                </div>
              </div>
              <div className="mt-6 border-t border-border pt-4 flex items-center justify-between">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-20" />
              </div>
            </div>
          ))}
        </div>
      </Page>
    );
  }

  if (isError) {
    return (
      <Page title="Projects" className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <ErrorState error={error} onRetry={() => void refetch()} />
      </Page>
    );
  }

  if (!projects || projects.length === 0) {
    return (
      <Page title="Projects" className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h1 className="bg-gradient-to-r from-fg to-muted bg-clip-text text-3xl font-semibold tracking-tight text-transparent">
            Knowledge base
          </h1>
          <p className="mt-1 text-sm text-muted">0 projects · 0 concepts</p>
        </div>
        <EmptyState
          icon={FolderKanban}
          title="No projects yet"
          hint="Agents create them with create_project, or POST /api/v1/projects."
          className="mt-6 py-16"
        />
      </Page>
    );
  }

  return (
    <Page title="Projects" className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Header */}
      <div>
        <h1 className="bg-gradient-to-r from-fg to-muted bg-clip-text text-3xl font-semibold tracking-tight text-transparent">
          Knowledge base
        </h1>
        <p className="mt-1 text-sm text-muted">
          {projects.length} {projects.length === 1 ? "project" : "projects"} · {totalConcepts}{" "}
          {totalConcepts === 1 ? "concept" : "concepts"}
        </p>
      </div>

      {/* Filter */}
      <div className="mt-6">
        <div className="relative max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle" />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter projects…"
            className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-sm text-fg placeholder:text-muted transition-colors focus-visible:outline-2 outline-accent-500"
          />
        </div>
      </div>

      {/* Projects Grid or Filter Empty State */}
      {filteredAndSorted.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No matching projects"
          hint={`No projects match "${filter}". Try adjusting your filter.`}
          className="mt-8 py-12"
        />
      ) : (
        <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filteredAndSorted.map((p) => (
            <Link
              key={p.project}
              to={`/p/${encodeURIComponent(p.project)}`}
              className="group flex flex-col justify-between rounded-xl border border-border bg-surface p-5 transition-all duration-150 hover:-translate-y-px hover:border-border-strong hover:shadow-[0_8px_30px_-12px_rgb(139_92_246/0.35)]"
            >
              <div>
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="text-base font-semibold tracking-tight text-fg transition-colors group-hover:text-accent-500 truncate">
                    {p.title}
                  </h2>
                  <span className="shrink-0 font-mono text-xs text-subtle">{p.project}</span>
                </div>
                <p className="mt-2 line-clamp-2 text-sm text-muted min-h-[2.5rem]">
                  {p.description || "No description provided."}
                </p>
              </div>

              <div className="mt-5 border-t border-border pt-3">
                <div className="flex items-center gap-3 text-xs text-muted">
                  <span className="inline-flex items-center gap-1.5">
                    <FileText size={14} className="shrink-0 text-subtle" />
                    <span>{p.conceptCount}</span>
                  </span>
                  <span
                    className={clsx(
                      "inline-flex items-center gap-1.5",
                      p.staleCount > 0 ? "font-medium text-orange-600 dark:text-orange-400" : "text-muted",
                    )}
                  >
                    <Clock size={14} className="shrink-0" />
                    <span>{p.staleCount} stale</span>
                  </span>
                  <span className="ml-auto text-subtle truncate">
                    {p.updatedAt ? `Updated ${relativeTime(p.updatedAt)}` : "Never updated"}
                  </span>
                </div>

                {p.repositories && p.repositories.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    {p.repositories.map((repo) => {
                      const slashIdx = repo.indexOf("/");
                      const ownerRepo = slashIdx !== -1 ? repo.slice(slashIdx + 1) : repo;
                      return (
                        <span
                          key={repo}
                          className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-muted ring-1 ring-border/50"
                          title={repo}
                        >
                          <GitBranch size={11} className="shrink-0 text-subtle" />
                          <span className="truncate max-w-[140px]">{ownerRepo}</span>
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </Page>
  );
}
