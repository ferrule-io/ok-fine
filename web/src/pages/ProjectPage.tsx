import { Boxes, Clock, Download, FileText, Folder, GitBranch, History, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { downloadArchive } from "../api/client.js";
import { useConcept, useHistory, useIndex, useProject } from "../api/queries.js";
import { Avatar } from "../components/Avatar.js";
import { ErrorState } from "../components/ErrorState.js";
import { Markdown } from "../components/Markdown.js";
import { Page } from "../components/Page.js";
import { Skeleton } from "../components/Skeleton.js";
import { StatCard } from "../components/StatCard.js";
import { useTreeState } from "../components/TreeState.js";
import { TypeIcon } from "../components/TypeIcon.js";
import { absoluteTime, relativeTime } from "../lib/format.js";

export function ProjectPage() {
  const params = useParams();
  const project = params.project ?? "";
  const treeState = useTreeState();

  const [isDownloading, setIsDownloading] = useState(false);

  const { data: details, isLoading, isError, error, refetch } = useProject(project);
  const overviewQuery = useConcept(project, "overview");
  const indexQuery = useIndex(project, "");
  const historyQuery = useHistory(project, { limit: 8 });

  const rootDirs = useMemo(() => {
    if (!indexQuery.data) return [];
    return indexQuery.data
      .filter((e): e is Extract<typeof e, { kind: "directory" }> => e.kind === "directory")
      .sort((a, b) => a.path.localeCompare(b.path));
  }, [indexQuery.data]);

  const topTypes = useMemo(() => {
    if (!details?.typeCounts) return [];
    return Object.entries(details.typeCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5);
  }, [details?.typeCounts]);

  const trustMetrics = useMemo(() => {
    if (!details?.trustTierCounts) {
      return { total: 0, human: 0, machine: 0, unverified: 0, proposed: 0 };
    }
    const human = details.trustTierCounts["human-reviewed"] ?? 0;
    const machine = details.trustTierCounts["machine-confirmed"] ?? 0;
    const unverified = details.trustTierCounts.unverified ?? 0;
    const proposed = details.trustTierCounts.proposed ?? 0;
    const total = human + machine + unverified + proposed;
    return { total, human, machine, unverified, proposed };
  }, [details?.trustTierCounts]);

  const handleExport = async () => {
    try {
      setIsDownloading(true);
      await downloadArchive(project);
    } catch {
      // Handled or ignored
    } finally {
      setIsDownloading(false);
    }
  };

  if (isLoading) {
    return (
      <Page title={project || "Project"} className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="space-y-3">
          <Skeleton className="h-9 w-64 rounded-lg" />
          <Skeleton className="h-5 w-96 rounded-md" />
        </div>
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: skeleton items
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
        <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-12">
          <div className="lg:col-span-7 xl:col-span-8">
            <Skeleton className="h-96 rounded-xl" />
          </div>
          <div className="lg:col-span-5 xl:col-span-4 space-y-6">
            <Skeleton className="h-64 rounded-xl" />
            <Skeleton className="h-48 rounded-xl" />
          </div>
        </div>
      </Page>
    );
  }

  if (isError) {
    return (
      <Page title={project || "Project"} className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <ErrorState error={error} onRetry={() => void refetch()} />
      </Page>
    );
  }

  if (!details) {
    return null;
  }

  return (
    <Page title={details.title} className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Hero */}
      <div className="flex flex-col justify-between gap-4 border-b border-border pb-6 sm:flex-row sm:items-start">
        <div className="max-w-3xl">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-tight text-fg">{details.title}</h1>
            <span className="font-mono text-xs text-subtle">{details.project}</span>
          </div>
          {details.description && <p className="mt-2 text-base text-muted">{details.description}</p>}

          {details.repositories && details.repositories.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {details.repositories.map((repo) => {
                let repoUrl: string | null = null;
                try {
                  const parsed = new URL(`https://${repo}`);
                  if (parsed.protocol === "https:" && parsed.hostname) {
                    repoUrl = parsed.href;
                  }
                } catch {
                  // Ignore invalid repository URLs
                }
                if (!repoUrl) {
                  return null;
                }
                const slashIdx = repo.indexOf("/");
                const label = slashIdx !== -1 ? repo.slice(slashIdx + 1) : repo;
                return (
                  <a
                    key={repo}
                    href={repoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2 py-1 font-mono text-xs text-muted transition-colors hover:border-border-strong hover:text-fg"
                    title={`View ${repo}`}
                  >
                    <GitBranch size={13} className="shrink-0 text-subtle" />
                    <span>{label}</span>
                  </a>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={handleExport}
            disabled={isDownloading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-fg shadow-xs transition-colors hover:bg-surface-2 hover:border-border-strong disabled:opacity-50 focus-visible:outline-2 outline-accent-500"
          >
            <Download size={15} className="shrink-0 text-muted" />
            <span>{isDownloading ? "Exporting…" : "Export .tar.gz"}</span>
          </button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Concepts */}
        <StatCard
          label="Concepts"
          icon={FileText}
          value={details.conceptCount}
          to={`/search?project=${encodeURIComponent(project)}`}
        />

        {/* Stale */}
        <StatCard
          label="Stale"
          icon={Clock}
          value={details.staleCount}
          tone={details.staleCount > 0 ? "warn" : "default"}
          to={`/p/${encodeURIComponent(project)}/health`}
        />

        {/* Trust */}
        <StatCard label="Trust" icon={ShieldCheck}>
          <div className="mt-1">
            <div className="flex h-2 w-full overflow-hidden rounded-full bg-surface-2">
              {trustMetrics.total > 0 ? (
                <>
                  {trustMetrics.human > 0 && (
                    <div
                      style={{ width: `${(trustMetrics.human / trustMetrics.total) * 100}%` }}
                      className="bg-emerald-500"
                      title={`Human-reviewed: ${trustMetrics.human}`}
                    />
                  )}
                  {trustMetrics.machine > 0 && (
                    <div
                      style={{ width: `${(trustMetrics.machine / trustMetrics.total) * 100}%` }}
                      className="bg-sky-500"
                      title={`Machine-confirmed: ${trustMetrics.machine}`}
                    />
                  )}
                  {trustMetrics.unverified > 0 && (
                    <div
                      style={{ width: `${(trustMetrics.unverified / trustMetrics.total) * 100}%` }}
                      className="bg-zinc-400 dark:bg-zinc-600"
                      title={`Unverified: ${trustMetrics.unverified}`}
                    />
                  )}
                  {trustMetrics.proposed > 0 && (
                    <div
                      style={{ width: `${(trustMetrics.proposed / trustMetrics.total) * 100}%` }}
                      className="bg-violet-500"
                      title={`Proposed: ${trustMetrics.proposed}`}
                    />
                  )}
                </>
              ) : (
                <div className="w-full bg-surface-2" />
              )}
            </div>
            <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] text-muted">
              <span className="flex items-center gap-1 whitespace-nowrap">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                <span>{trustMetrics.human} human</span>
              </span>
              <span className="flex items-center gap-1 whitespace-nowrap">
                <span className="h-1.5 w-1.5 rounded-full bg-sky-500" />
                <span>{trustMetrics.machine} auto</span>
              </span>
              <span className="flex items-center gap-1 whitespace-nowrap">
                <span className="h-1.5 w-1.5 rounded-full bg-zinc-400 dark:bg-zinc-600" />
                <span>{trustMetrics.unverified} unverified</span>
              </span>
              <span className="flex items-center gap-1 whitespace-nowrap">
                <span className="h-1.5 w-1.5 rounded-full bg-violet-500" />
                <span>{trustMetrics.proposed} proposed</span>
              </span>
            </div>
          </div>
        </StatCard>

        {/* Types */}
        <StatCard label="Types" icon={Boxes}>
          {topTypes.length > 0 ? (
            <div className="mt-1 flex flex-wrap gap-1.5">
              {topTypes.map(([type, count]) => (
                <Link
                  key={type}
                  to={`/search?project=${encodeURIComponent(project)}&type=${encodeURIComponent(type)}`}
                  className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 text-xs text-muted transition-colors hover:bg-surface hover:text-fg ring-1 ring-border/50"
                >
                  <TypeIcon type={type} size={12} />
                  <span>{type}</span>
                  <span className="font-mono text-[10px] text-subtle">{count}</span>
                </Link>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-xs text-muted">No types recorded</p>
          )}
        </StatCard>
      </div>

      {/* Main 2-column content */}
      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-12">
        {/* Left Column: Overview prose via Markdown */}
        <div className="lg:col-span-7 xl:col-span-8">
          {overviewQuery.isLoading && (
            <div className="rounded-xl border border-border bg-surface p-6 space-y-4">
              <Skeleton className="h-7 w-48 rounded-md" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-4/6" />
            </div>
          )}

          {overviewQuery.data && (
            <div className="rounded-xl border border-border bg-surface p-6 sm:p-8">
              <Markdown project={project} concept={overviewQuery.data} />
            </div>
          )}
        </div>

        {/* Right Column: Recent activity and Browse */}
        <div className="space-y-6 lg:col-span-5 xl:col-span-4">
          {/* Recent activity */}
          <div className="rounded-xl border border-border bg-surface p-5">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight text-fg">
                <History size={16} className="text-muted" />
                <span>Recent activity</span>
              </h2>
              <Link
                to={`/p/${encodeURIComponent(project)}/activity`}
                className="text-xs font-medium text-accent-500 transition-colors hover:text-accent-600"
              >
                View all
              </Link>
            </div>

            <div className="mt-3 divide-y divide-border/50">
              {historyQuery.isLoading && (
                <div className="space-y-3 py-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: skeleton items
                    <div key={i} className="flex items-center gap-3">
                      <Skeleton className="h-6 w-6 rounded-full shrink-0" />
                      <div className="flex-1 space-y-1">
                        <Skeleton className="h-3.5 w-3/4" />
                        <Skeleton className="h-3 w-1/2" />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {historyQuery.data && historyQuery.data.length > 0
                ? historyQuery.data.map((entry) => {
                    const displayActor = entry.actor.startsWith("human:") ? entry.actor.slice(6) : entry.actor;

                    return (
                      <div key={entry.sha} className="flex items-start gap-3 py-2.5 first:pt-1 last:pb-1">
                        <Avatar actor={entry.actor} size={22} className="mt-0.5" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium text-fg" title={entry.subject}>
                            {entry.subject}
                          </p>
                          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">
                            <span className="truncate font-mono text-subtle max-w-[120px]">{displayActor}</span>
                            <span>·</span>
                            <span title={absoluteTime(entry.at)}>{relativeTime(entry.at)}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })
                : !historyQuery.isLoading && <p className="py-4 text-center text-xs text-muted">No recent activity</p>}
            </div>
          </div>

          {/* Browse */}
          <div className="rounded-xl border border-border bg-surface p-5">
            <div className="pb-3 border-b border-border">
              <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight text-fg">
                <Folder size={16} className="text-muted" />
                <span>Browse</span>
              </h2>
            </div>

            <div className="mt-3 space-y-2">
              {indexQuery.isLoading && (
                <div className="space-y-2">
                  <Skeleton className="h-10 w-full rounded-lg" />
                  <Skeleton className="h-10 w-full rounded-lg" />
                  <Skeleton className="h-10 w-full rounded-lg" />
                </div>
              )}

              {rootDirs.length > 0
                ? rootDirs.map((dir) => (
                    <button
                      key={dir.path}
                      type="button"
                      onClick={() => treeState.reveal(dir.path)}
                      className="group flex w-full items-center justify-between rounded-lg border border-border bg-surface-2/50 p-2.5 text-left transition-colors hover:border-border-strong hover:bg-surface-2 focus-visible:outline-2 outline-accent-500"
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        <Folder size={16} className="shrink-0 text-accent-500" />
                        <span className="truncate text-xs font-medium text-fg transition-colors group-hover:text-accent-500">
                          {dir.path}
                        </span>
                      </div>
                      <span className="ml-2 shrink-0 text-[11px] text-muted">
                        {dir.conceptCount} {dir.conceptCount === 1 ? "concept" : "concepts"}
                      </span>
                    </button>
                  ))
                : !indexQuery.isLoading && <p className="py-4 text-center text-xs text-muted">No directories</p>}
            </div>
          </div>
        </div>
      </div>
    </Page>
  );
}
