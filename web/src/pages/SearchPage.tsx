import { Search, SlidersHorizontal, Tag, X } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import type { Status, TrustTier } from "../../../src/okf/semantics.js";
import type { SearchParams } from "../api/client.js";
import { useProject, useProjects, useSearch } from "../api/queries.js";
import { StaleBadge, StatusBadge, TrustBadge, TypeBadge } from "../components/Badges.js";
import { EmptyState } from "../components/EmptyState.js";
import { ErrorState } from "../components/ErrorState.js";
import { Highlighted } from "../components/Highlighted.js";
import { Page } from "../components/Page.js";
import { Skeleton } from "../components/Skeleton.js";
import { CONCEPT_TYPES } from "../components/TypeIcon.js";

export function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const q = searchParams.get("q") ?? "";
  const project = searchParams.get("project") ?? "";
  const type = searchParams.get("type") ?? "";
  const tags = searchParams.getAll("tag");
  const status = searchParams.get("status") ?? "";
  const trustTier = searchParams.get("trustTier") ?? "";
  const stale = searchParams.get("stale") ?? "";

  const [tagInput, setTagInput] = useState("");

  const { data: projects } = useProjects();
  const { data: projectDetails } = useProject(project);

  const availableTypes = useMemo(() => {
    if (project && projectDetails?.typeCounts) {
      const counts = Object.keys(projectDetails.typeCounts);
      if (counts.length > 0) return counts;
    }
    return CONCEPT_TYPES;
  }, [project, projectDetails?.typeCounts]);

  const searchPayload: SearchParams = useMemo(() => {
    const payload: SearchParams = {
      limit: 50,
    };
    if (q.trim()) payload.q = q.trim();
    if (project) payload.project = project;
    if (type) payload.type = type;
    if (tags.length > 0) payload.tag = tags;
    if (status) payload.status = status as Status;
    if (trustTier) payload.trustTier = trustTier as TrustTier;
    if (stale === "true") payload.stale = true;
    if (stale === "false") payload.stale = false;
    return payload;
  }, [q, project, type, tags, status, trustTier, stale]);

  const { data: hits, isLoading, isError, error, refetch } = useSearch(searchPayload);

  const updateParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (!value) {
      next.delete(key);
    } else {
      next.set(key, value);
    }
    setSearchParams(next, { replace: true });
  };

  const addTag = (newTag: string) => {
    const trimmed = newTag.trim();
    if (!trimmed || tags.includes(trimmed)) return;
    const next = new URLSearchParams(searchParams);
    next.append("tag", trimmed);
    setSearchParams(next, { replace: true });
    setTagInput("");
  };

  const removeTag = (tagToRemove: string) => {
    const next = new URLSearchParams(searchParams);
    next.delete("tag");
    for (const t of tags) {
      if (t !== tagToRemove) {
        next.append("tag", t);
      }
    }
    setSearchParams(next, { replace: true });
  };

  const handleTagSubmit = (e: FormEvent) => {
    e.preventDefault();
    addTag(tagInput);
  };

  const hasActiveFilters = Boolean(project || type || tags.length > 0 || status || trustTier || stale);

  const clearFilters = () => {
    const next = new URLSearchParams();
    if (q) next.set("q", q);
    setSearchParams(next, { replace: true });
  };

  return (
    <Page title="Search" className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Header & Big Search Input */}
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-fg">Search Knowledge Base</h1>
          <p className="mt-1 text-sm text-muted">
            Find concepts, decisions, conventions, and architectural records across projects.
          </p>
        </div>

        <div className="relative">
          <Search size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-subtle" />
          <input
            type="text"
            value={q}
            onChange={(e) => updateParam("q", e.target.value)}
            placeholder="Search concepts by keyword, text, title…"
            className="w-full rounded-xl border border-border bg-surface py-3.5 pl-12 pr-4 text-base text-fg shadow-xs placeholder:text-muted transition-colors focus-visible:outline-2 outline-accent-500"
          />
        </div>
      </div>

      {/* Filter Row */}
      <div className="mt-6 flex flex-wrap items-center gap-2.5 rounded-xl border border-border bg-surface p-3 sm:gap-3">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted">
          <SlidersHorizontal size={14} className="text-subtle" />
          <span>Filter:</span>
        </div>

        {/* Project Select */}
        <select
          value={project}
          onChange={(e) => updateParam("project", e.target.value)}
          className="rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-fg transition-colors hover:border-border-strong focus-visible:outline-2 outline-accent-500"
        >
          <option value="">All projects</option>
          {projects?.map((p) => (
            <option key={p.project} value={p.project}>
              {p.title}
            </option>
          ))}
        </select>

        {/* Type Select */}
        <select
          value={type}
          onChange={(e) => updateParam("type", e.target.value)}
          className="rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-fg transition-colors hover:border-border-strong focus-visible:outline-2 outline-accent-500"
        >
          <option value="">All types</option>
          {availableTypes.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>

        {/* Status Select */}
        <select
          value={status}
          onChange={(e) => updateParam("status", e.target.value)}
          className="rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-fg transition-colors hover:border-border-strong focus-visible:outline-2 outline-accent-500"
        >
          <option value="">Any status</option>
          <option value="draft">Draft</option>
          <option value="stable">Stable</option>
          <option value="deprecated">Deprecated</option>
        </select>

        {/* Trust Tier Select */}
        <select
          value={trustTier}
          onChange={(e) => updateParam("trustTier", e.target.value)}
          className="rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-fg transition-colors hover:border-border-strong focus-visible:outline-2 outline-accent-500"
        >
          <option value="">Any trust</option>
          <option value="human-reviewed">Human-reviewed</option>
          <option value="machine-confirmed">Machine-confirmed</option>
          <option value="unverified">Unverified</option>
        </select>

        {/* Stale Select */}
        <select
          value={stale}
          onChange={(e) => updateParam("stale", e.target.value)}
          className="rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-fg transition-colors hover:border-border-strong focus-visible:outline-2 outline-accent-500"
        >
          <option value="">Any staleness</option>
          <option value="true">Stale</option>
          <option value="false">Fresh</option>
        </select>

        {/* Add tag form */}
        <form onSubmit={handleTagSubmit} className="flex items-center">
          <input
            type="text"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            placeholder="+ tag…"
            className="w-20 rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-xs text-fg placeholder:text-subtle transition-colors focus-visible:outline-2 outline-accent-500"
          />
        </form>

        {hasActiveFilters && (
          <button
            type="button"
            onClick={clearFilters}
            className="ml-auto text-xs font-medium text-accent-500 hover:text-accent-600 transition-colors"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Selected Tag Chips */}
      {tags.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted flex items-center gap-1">
            <Tag size={12} className="text-subtle" />
            <span>Tags:</span>
          </span>
          {tags.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 rounded-md border border-accent-500/20 bg-accent-500/10 px-2 py-0.5 font-mono text-xs text-accent-600 dark:text-accent-400"
            >
              <span>#{t}</span>
              <button
                type="button"
                onClick={() => removeTag(t)}
                className="hover:text-fg transition-colors"
                title={`Remove tag ${t}`}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Results Section */}
      <div className="mt-8">
        {isLoading && (
          <div className="space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: skeleton items
              <div key={i} className="rounded-xl border border-border bg-surface p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-5 w-40" />
                    <Skeleton className="h-5 w-20" />
                  </div>
                  <Skeleton className="h-5 w-24" />
                </div>
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            ))}
          </div>
        )}

        {isError && <ErrorState error={error} onRetry={() => void refetch()} />}

        {!isLoading && !isError && hits && hits.length === 0 && (
          <EmptyState
            icon={Search}
            title="No matches"
            hint="Try adjusting your keywords, expanding your project scope, or clearing filters."
            className="py-16"
          />
        )}

        {!isLoading && !isError && hits && hits.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-muted pb-1">
              <span>
                Found {hits.length} {hits.length === 1 ? "result" : "results"}
              </span>
            </div>

            {hits.map((hit) => (
              <Link
                key={`${hit.project}/${hit.id}`}
                to={`/p/${encodeURIComponent(hit.project)}/c/${hit.id}`}
                className="group block rounded-xl border border-border bg-surface p-5 transition-all duration-150 hover:-translate-y-px hover:border-border-strong hover:shadow-[0_8px_30px_-12px_rgb(139_92_246/0.35)]"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-semibold tracking-tight text-fg transition-colors group-hover:text-accent-500">
                      <Highlighted text={hit.title} query={q} />
                    </h2>
                    <TypeBadge type={hit.type} />
                    <span className="font-mono text-xs text-subtle">
                      {hit.project}/{hit.id}
                    </span>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <StatusBadge status={hit.status} />
                    <TrustBadge tier={hit.trustTier} />
                    {hit.stale && <StaleBadge />}
                  </div>
                </div>

                {hit.snippet ? (
                  <p className="mt-2.5 text-sm text-muted break-words line-clamp-2">
                    <Highlighted text={hit.snippet} query={q} />
                  </p>
                ) : (
                  hit.description && (
                    <p className="mt-2.5 text-sm text-muted break-words line-clamp-2">
                      <Highlighted text={hit.description} query={q} />
                    </p>
                  )
                )}

                {hit.tags && hit.tags.length > 0 && (
                  <div className="mt-3.5 flex flex-wrap items-center gap-1.5 pt-1">
                    {hit.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-muted ring-1 ring-border/50"
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>
    </Page>
  );
}
