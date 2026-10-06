import { clsx } from "clsx";
import { AlertCircle, AlertTriangle, ChevronDown, Code, ExternalLink, Info } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { useConcept, useHistory } from "../api/queries.js";
import { Avatar } from "../components/Avatar.js";
import { StaleBadge, StatusBadge, TrustBadge, TypeBadge } from "../components/Badges.js";
import { CodeBlock } from "../components/CodeBlock.js";
import { ConnectionsGraph } from "../components/ConnectionsGraph.js";
import { CopyButton } from "../components/CopyButton.js";
import { EmptyState } from "../components/EmptyState.js";
import { ErrorState } from "../components/ErrorState.js";
import { Markdown } from "../components/Markdown.js";
import { Page } from "../components/Page.js";
import { Skeleton } from "../components/Skeleton.js";
import { Toc } from "../components/Toc.js";
import { absoluteTime, relativeTime, shortSha } from "../lib/format.js";
import type { RenderedMarkdown } from "../lib/markdown.js";
import { addRecent } from "../lib/recent.js";
import { extraFrontmatter, readSources, readVerified, type SourceRef } from "../lib/sources.js";

export function ConceptPage() {
  const params = useParams();
  const project = params.project ?? "";
  const id = params["*"] ?? "";

  const { data: concept, isLoading, error, refetch } = useConcept(project, id);
  const { data: historyEntries } = useHistory(project, { id, limit: 10 });

  const [headings, setHeadings] = useState<RenderedMarkdown["headings"]>([]);
  const [citations, setCitations] = useState<string[]>([]);
  const [showSource, setShowSource] = useState(false);

  useEffect(() => {
    if (concept) {
      addRecent({
        project,
        id: concept.id,
        title: concept.derived?.title ?? concept.id,
        type: concept.derived?.type ?? null,
      });
    }
  }, [concept, project]);

  const orderedSources = useMemo(() => {
    if (!concept) {
      return [];
    }
    const rawSources = readSources(concept.frontmatter);
    const sourceMap = new Map<string, SourceRef>();
    for (const s of rawSources) {
      sourceMap.set(s.id, s);
    }

    const result: SourceRef[] = [];
    const seenIds = new Set<string>();

    for (const citeLabel of citations) {
      const source = sourceMap.get(citeLabel);
      if (source && !seenIds.has(source.id)) {
        result.push(source);
        seenIds.add(source.id);
      }
    }

    for (const s of rawSources) {
      if (!seenIds.has(s.id)) {
        result.push(s);
        seenIds.add(s.id);
      }
    }

    return result;
  }, [concept, citations]);

  const pageTitle = concept?.derived?.title ?? (id || "Concept");

  if (isLoading) {
    return (
      <Page title={pageTitle} className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <div className="space-y-3 border-b border-border pb-6">
          <div className="flex gap-2">
            <Skeleton className="h-5 w-20 rounded-full" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
          <Skeleton className="h-9 w-96 rounded-md" />
          <Skeleton className="h-5 w-full max-w-xl rounded-md" />
        </div>
        <div className="flex flex-col xl:flex-row gap-8">
          <div className="flex-1 space-y-4">
            <Skeleton className="h-32 w-full rounded-xl" />
            <Skeleton className="h-48 w-full rounded-xl" />
          </div>
          <div className="w-full xl:w-72 space-y-4">
            <Skeleton className="h-40 w-full rounded-xl" />
            <Skeleton className="h-40 w-full rounded-xl" />
          </div>
        </div>
      </Page>
    );
  }

  if (error) {
    return (
      <Page title={pageTitle} className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <ErrorState error={error} onRetry={refetch} fullScreen />
      </Page>
    );
  }

  if (!concept) {
    return (
      <Page title={pageTitle} className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <EmptyState title="Concept not found" hint={`Could not find concept "${id}" in project "${project}".`} />
      </Page>
    );
  }

  const isDeprecated = concept.derived?.status?.toLowerCase() === "deprecated";
  const verifications = readVerified(concept.frontmatter);
  const extras = extraFrontmatter(concept.frontmatter);

  return (
    <Page title={`${pageTitle} · ${project}`} className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
      {/* Header */}
      <header className="space-y-4 border-b border-border pb-6">
        <div className="flex flex-wrap items-center gap-2">
          <TypeBadge type={concept.derived?.type ?? null} />
          {concept.derived?.status && <StatusBadge status={concept.derived.status} />}
          {concept.derived?.trustTier && <TrustBadge tier={concept.derived.trustTier} />}
          {concept.derived?.stale && <StaleBadge />}
        </div>

        <div>
          <h1
            className={clsx("text-3xl font-semibold tracking-tight text-fg", isDeprecated && "line-through opacity-70")}
          >
            {concept.derived?.title ?? concept.id}
          </h1>

          {concept.derived?.description && (
            <p className="mt-2 text-lg text-muted leading-relaxed">{concept.derived.description}</p>
          )}
        </div>

        {concept.derived?.tags && concept.derived.tags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            {concept.derived.tags.map((tag) => (
              <Link
                key={tag}
                to={`/search?project=${encodeURIComponent(project)}&tag=${encodeURIComponent(tag)}`}
                className="inline-flex items-center rounded-md bg-surface-2 px-2 py-0.5 text-xs font-medium text-muted hover:text-fg hover:bg-border transition-colors"
              >
                #{tag}
              </Link>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-2">
          <CopyButton value={typeof window !== "undefined" ? window.location.href : ""} label="Copy link" />
          <CopyButton value={concept.id} label="Copy ID" />
          <button
            type="button"
            onClick={() => setShowSource((prev) => !prev)}
            aria-label="Toggle markdown source"
            className={clsx(
              "inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-2 outline-accent-500 cursor-pointer",
              showSource
                ? "bg-accent-500/10 text-accent-500 border-accent-500/30"
                : "bg-surface text-muted hover:bg-surface-2 hover:text-fg",
            )}
          >
            <Code size={14} className="shrink-0" />
            <span>Source</span>
          </button>
        </div>
      </header>

      {/* Main Body & Right Rail */}
      <div className="mt-8 flex flex-col xl:flex-row xl:items-start gap-8">
        {/* Left Column: Markdown or Raw Source */}
        <div className="min-w-0 flex-1">
          {showSource ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs text-muted">
                <span className="font-mono">Raw Markdown</span>
                <CopyButton value={concept.markdown} label="Copy markdown" />
              </div>
              <CodeBlock
                code={concept.markdown}
                lang="markdown"
                lineNumbers
                className="rounded-xl border border-border bg-surface-2 shadow-xs"
              />
            </div>
          ) : (
            <Markdown project={project} concept={concept} onHeadings={setHeadings} onCitations={setCitations} />
          )}
        </div>

        {/* Right Rail: sticky on desktop, stacked below on smaller screens */}
        <aside className="w-full xl:w-72 xl:sticky xl:top-20 shrink-0 space-y-6">
          {/* 1. Toc */}
          {headings.length >= 3 && <Toc headings={headings} />}

          {/* 2. Details */}
          <div className="space-y-3 rounded-xl border border-border bg-surface-2/30 p-3.5 text-xs">
            <div className="font-semibold uppercase tracking-wider text-muted">Details</div>

            {concept.derived?.generatedAt && (
              <div className="flex items-start justify-between gap-2">
                <span className="text-muted shrink-0">Generated</span>
                <span
                  className="text-fg text-right font-mono text-[11px]"
                  title={absoluteTime(concept.derived.generatedAt)}
                >
                  {relativeTime(concept.derived.generatedAt)}
                  {concept.derived.generatedBy && ` by ${concept.derived.generatedBy}`}
                </span>
              </div>
            )}

            <div className="space-y-1.5">
              <span className="text-muted block">Verified</span>
              {verifications.length > 0 ? (
                <div className="space-y-1.5 pl-1">
                  {verifications.map((v, i) => (
                    <div key={`${v.by}-${v.at ?? i}`} className="flex items-center justify-between gap-2 text-fg">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Avatar actor={v.by} size={18} />
                        <span className="truncate font-mono text-[11px]">{v.by}</span>
                      </div>
                      {v.at && (
                        <span className="text-muted text-[10px] shrink-0" title={absoluteTime(v.at)}>
                          {relativeTime(v.at)}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-subtle italic pl-1">Unverified</div>
              )}
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="text-muted">Stale after</span>
              <span
                className={clsx(
                  "font-mono text-[11px]",
                  concept.derived?.stale ? "text-orange-500 font-semibold" : "text-fg",
                )}
              >
                {concept.derived?.staleAfter ? concept.derived.staleAfter.split("T")[0] : "—"}
              </span>
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="text-muted">Revision</span>
              <span className="font-mono text-[11px] text-muted">{concept.revision.slice(0, 8)}</span>
            </div>
          </div>

          {/* 3. Sources */}
          {orderedSources.length > 0 && (
            <div className="space-y-2 rounded-xl border border-border bg-surface-2/30 p-3.5 text-xs">
              <div className="font-semibold uppercase tracking-wider text-muted">Sources ({orderedSources.length})</div>
              <ol className="space-y-2">
                {orderedSources.map((source, i) => (
                  <li
                    key={source.id}
                    id={`source-${source.id}`}
                    className="rounded-lg p-2 transition-colors border border-transparent hover:border-border hover:bg-surface-2/50"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="font-mono text-muted text-[10px] shrink-0">{i + 1}.</span>
                        <span className="font-mono text-fg text-xs truncate" title={source.label}>
                          {source.label}
                        </span>
                      </div>
                      {source.commit && (
                        <span
                          className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-surface border border-border text-muted shrink-0"
                          title={`Commit ${source.commit}`}
                        >
                          {shortSha(source.commit)}
                        </span>
                      )}
                    </div>
                    {source.url && (
                      <div className="mt-1 pl-4">
                        <a
                          href={source.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] text-accent-500 hover:text-accent-400 hover:underline truncate max-w-full"
                        >
                          <span className="truncate">{source.resource}</span>
                          <ExternalLink size={10} className="shrink-0" />
                        </a>
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* 4. ConnectionsGraph */}
          <ConnectionsGraph
            project={project}
            conceptId={concept.id}
            inbound={concept.links.inbound}
            outbound={concept.links.outbound}
          />

          {/* 5. History */}
          <div className="space-y-3 rounded-xl border border-border bg-surface-2/30 p-3.5 text-xs">
            <div className="font-semibold uppercase tracking-wider text-muted">History</div>
            {historyEntries && historyEntries.length > 0 ? (
              <div className="relative pl-4 space-y-4 before:absolute before:left-1.5 before:top-2 before:bottom-2 before:w-px before:bg-border">
                {historyEntries.map((entry) => (
                  <div key={entry.sha} className="relative space-y-1">
                    <div className="absolute -left-4 top-1.5 h-2 w-2 rounded-full bg-accent-500 ring-2 ring-surface" />
                    <div className="flex items-center justify-between gap-1 text-[11px]">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Avatar actor={entry.actor} size={16} />
                        <span className="truncate font-mono text-fg">{entry.actor}</span>
                      </div>
                      <span className="text-muted shrink-0 text-[10px]" title={absoluteTime(entry.at)}>
                        {relativeTime(entry.at)}
                      </span>
                    </div>
                    <p className="text-fg text-xs break-words">{entry.subject}</p>
                    <div className="flex items-center gap-1">
                      <CopyButton
                        value={entry.sha}
                        label={shortSha(entry.sha)}
                        className="px-1.5 py-0.5 text-[10px] font-mono"
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-subtle italic">No history available</div>
            )}
          </div>

          {/* 6. Lint issues */}
          {concept.issues && concept.issues.length > 0 && (
            <div className="space-y-2 rounded-xl border border-border bg-surface-2/30 p-3.5 text-xs">
              <div className="font-semibold uppercase tracking-wider text-muted">
                Lint issues ({concept.issues.length})
              </div>
              <div className="space-y-2">
                {concept.issues.map((issue) => (
                  <div
                    key={`${issue.code}-${issue.path}-${issue.message}`}
                    className="flex items-start gap-2 p-2 rounded-lg bg-surface border border-border/60"
                  >
                    {issue.severity === "error" ? (
                      <AlertCircle size={14} className="text-rose-500 shrink-0 mt-0.5" />
                    ) : issue.severity === "warning" ? (
                      <AlertTriangle size={14} className="text-amber-500 shrink-0 mt-0.5" />
                    ) : (
                      <Info size={14} className="text-sky-500 shrink-0 mt-0.5" />
                    )}
                    <div className="min-w-0 space-y-0.5">
                      <div className="font-mono font-semibold text-[11px] text-fg">{issue.code}</div>
                      <p className="text-muted text-[11px] leading-tight break-words">{issue.message}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 7. Extra frontmatter */}
          {extras.length > 0 && (
            <details className="group rounded-xl border border-border bg-surface-2/30 p-3.5 text-xs">
              <summary className="cursor-pointer font-semibold uppercase tracking-wider text-muted hover:text-fg flex items-center justify-between select-none">
                <span>Extra frontmatter ({extras.length})</span>
                <ChevronDown size={14} className="transition-transform group-open:rotate-180" />
              </summary>
              <div className="mt-2 space-y-1 overflow-x-auto rounded-lg bg-surface p-2 font-mono text-[11px] border border-border/50">
                {extras.map(([key, val]) => (
                  <div key={key} className="break-all">
                    <span className="text-accent-500">{key}</span>:{" "}
                    <span className="text-muted">{JSON.stringify(val)}</span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </aside>
      </div>
    </Page>
  );
}
