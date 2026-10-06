import { clsx } from "clsx";
import { AlertCircle, AlertTriangle, CheckCircle2, Clock, Info } from "lucide-react";
import { useMemo } from "react";
import { Link, useParams } from "react-router";
import type { LintIssue } from "../../../src/okf/lint.js";
import { useLint, useProject, useSearch } from "../api/queries.js";
import { Pill, StaleBadge, StatusBadge, TrustBadge } from "../components/Badges.js";
import { EmptyState } from "../components/EmptyState.js";
import { ErrorState } from "../components/ErrorState.js";
import { Page } from "../components/Page.js";
import { Skeleton } from "../components/Skeleton.js";
import { TypeIcon } from "../components/TypeIcon.js";

export function HealthPage() {
  const params = useParams();
  const project = params.project ?? "";

  const { data: projectDetails } = useProject(project);

  const lintQuery = useLint(project);
  const staleQuery = useSearch({ project, stale: true, limit: 100 });
  const unverifiedQuery = useSearch({ project, trustTier: "unverified", limit: 100 });

  const isLoading = lintQuery.isLoading || staleQuery.isLoading || unverifiedQuery.isLoading;
  const isError = lintQuery.isError || staleQuery.isError || unverifiedQuery.isError;
  const firstError = lintQuery.error || staleQuery.error || unverifiedQuery.error;

  const handleRetry = () => {
    void lintQuery.refetch();
    void staleQuery.refetch();
    void unverifiedQuery.refetch();
  };

  const groupedIssues = useMemo(() => {
    if (!lintQuery.data) return { errors: [], warnings: [], infos: [] };
    const errors: LintIssue[] = [];
    const warnings: LintIssue[] = [];
    const infos: LintIssue[] = [];

    for (const issue of lintQuery.data) {
      if (issue.severity === "error") {
        errors.push(issue);
      } else if (issue.severity === "warning") {
        warnings.push(issue);
      } else {
        infos.push(issue);
      }
    }
    return { errors, warnings, infos };
  }, [lintQuery.data]);

  const pageTitle = projectDetails?.title ? `${projectDetails.title} Health` : "Health";

  if (isLoading) {
    return (
      <Page title={pageTitle} className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="space-y-2">
          <Skeleton className="h-4 w-32 rounded-md" />
          <Skeleton className="h-8 w-48 rounded-lg" />
        </div>
        <div className="mt-8 space-y-10">
          {Array.from({ length: 3 }).map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: skeleton items
            <div key={i} className="space-y-4">
              <Skeleton className="h-7 w-48 rounded-md" />
              <div className="rounded-xl border border-border bg-surface p-4 space-y-3">
                <Skeleton className="h-12 w-full rounded-lg" />
                <Skeleton className="h-12 w-full rounded-lg" />
              </div>
            </div>
          ))}
        </div>
      </Page>
    );
  }

  if (isError) {
    return (
      <Page title={pageTitle} className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <ErrorState error={firstError} onRetry={handleRetry} />
      </Page>
    );
  }

  const issues = lintQuery.data ?? [];
  const staleHits = staleQuery.data ?? [];
  const unverifiedHits = unverifiedQuery.data ?? [];

  const errorCount = groupedIssues.errors.length;

  return (
    <Page title={pageTitle} className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-2 text-xs text-muted">
          <Link to={`/p/${encodeURIComponent(project)}`} className="transition-colors hover:text-fg">
            {projectDetails?.title ?? project}
          </Link>
          <span>/</span>
          <span className="text-fg">Health</span>
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-fg">Knowledge Base Health</h1>
            <p className="mt-1 text-sm text-muted">
              Lint diagnostics, staleness, and verification status for {projectDetails?.title ?? project}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-10">
        {/* Section 1: Lint */}
        <section className="space-y-4">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold tracking-tight text-fg">Specification Conformance</h2>
              {errorCount === 0 ? (
                <Pill className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 ring-emerald-500/20">
                  <CheckCircle2 size={13} />
                  <span>Conformant</span>
                </Pill>
              ) : (
                <Pill className="bg-rose-500/10 text-rose-600 dark:text-rose-400 ring-rose-500/20">
                  <AlertCircle size={13} />
                  <span>
                    {errorCount} {errorCount === 1 ? "error" : "errors"}
                  </span>
                </Pill>
              )}
            </div>
            <span className="text-xs text-muted">({issues.length})</span>
          </div>

          {issues.length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              title="All concepts and files conform"
              hint="No lint or specification issues found in this project."
              className="py-10"
            />
          ) : (
            <div className="overflow-hidden rounded-xl border border-border bg-surface divide-y divide-border">
              {[...groupedIssues.errors, ...groupedIssues.warnings, ...groupedIssues.infos].map((issue, idx) => {
                const isMd = issue.path.endsWith(".md");
                const targetUrl = isMd
                  ? `/p/${encodeURIComponent(project)}/c/${issue.path.slice(0, -3)}`
                  : `/p/${encodeURIComponent(project)}/f/${issue.path}`;

                let SevIcon = Info;
                let sevColor = "text-sky-500 bg-sky-500/10 ring-sky-500/20";
                if (issue.severity === "error") {
                  SevIcon = AlertCircle;
                  sevColor = "text-rose-600 dark:text-rose-400 bg-rose-500/10 ring-rose-500/20";
                } else if (issue.severity === "warning") {
                  SevIcon = AlertTriangle;
                  sevColor = "text-amber-600 dark:text-amber-400 bg-amber-500/10 ring-amber-500/20";
                }

                return (
                  // biome-ignore lint/suspicious/noArrayIndexKey: stable listing
                  <div key={idx} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-start gap-3 min-w-0">
                      <div
                        className={clsx(
                          "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ring-1",
                          sevColor,
                        )}
                      >
                        <SevIcon size={14} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs font-semibold text-fg">{issue.code}</span>
                          <span className="text-xs text-muted">on</span>
                          <Link
                            to={targetUrl}
                            className="font-mono text-xs text-accent-500 hover:text-accent-600 transition-colors truncate max-w-sm"
                            title={`Navigate to ${issue.path}`}
                          >
                            {issue.path}
                          </Link>
                        </div>
                        <p className="mt-1 text-sm text-muted break-words">{issue.message}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Section 2: Stale */}
        <section className="space-y-4">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold tracking-tight text-fg">Stale Concepts</h2>
              {staleHits.length > 0 && <StaleBadge />}
            </div>
            <span className="text-xs text-muted">({staleHits.length})</span>
          </div>

          {staleHits.length === 0 ? (
            <EmptyState
              icon={Clock}
              title="No stale concepts"
              hint="All concepts are within their defined freshness interval."
              className="py-10"
            />
          ) : (
            <div className="overflow-hidden rounded-xl border border-border bg-surface divide-y divide-border">
              {staleHits.map((hit) => (
                <Link
                  key={hit.id}
                  to={`/p/${encodeURIComponent(project)}/c/${hit.id}`}
                  className="group flex flex-col gap-3 p-4 transition-colors hover:bg-surface-2 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <TypeIcon type={hit.type} size={18} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold tracking-tight text-fg transition-colors group-hover:text-accent-500 truncate">
                          {hit.title}
                        </span>
                        <span className="font-mono text-xs text-subtle shrink-0">{hit.id}</span>
                      </div>
                      {hit.description && <p className="mt-0.5 line-clamp-1 text-xs text-muted">{hit.description}</p>}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                    <StatusBadge status={hit.status} />
                    <TrustBadge tier={hit.trustTier} />
                    <StaleBadge />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* Section 3: Unverified */}
        <section className="space-y-4">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold tracking-tight text-fg">Unverified Concepts</h2>
            </div>
            <span className="text-xs text-muted">({unverifiedHits.length})</span>
          </div>

          {unverifiedHits.length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              title="All concepts verified"
              hint="Every concept has been machine-confirmed or human-reviewed."
              className="py-10"
            />
          ) : (
            <div className="overflow-hidden rounded-xl border border-border bg-surface divide-y divide-border">
              {unverifiedHits.map((hit) => (
                <Link
                  key={hit.id}
                  to={`/p/${encodeURIComponent(project)}/c/${hit.id}`}
                  className="group flex flex-col gap-3 p-4 transition-colors hover:bg-surface-2 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <TypeIcon type={hit.type} size={18} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold tracking-tight text-fg transition-colors group-hover:text-accent-500 truncate">
                          {hit.title}
                        </span>
                        <span className="font-mono text-xs text-subtle shrink-0">{hit.id}</span>
                      </div>
                      {hit.description && <p className="mt-0.5 line-clamp-1 text-xs text-muted">{hit.description}</p>}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                    <StatusBadge status={hit.status} />
                    <TrustBadge tier={hit.trustTier} />
                    {hit.stale && <StaleBadge />}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </Page>
  );
}
