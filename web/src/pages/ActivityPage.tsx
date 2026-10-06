import { Bot, History, User } from "lucide-react";
import { useMemo } from "react";
import { Link, useParams } from "react-router";
import type { HistoryEntry } from "../../../src/store/backend.js";
import { useHistory, useProject } from "../api/queries.js";
import { Avatar } from "../components/Avatar.js";
import { CopyButton } from "../components/CopyButton.js";
import { EmptyState } from "../components/EmptyState.js";
import { ErrorState } from "../components/ErrorState.js";
import { Page } from "../components/Page.js";
import { Skeleton } from "../components/Skeleton.js";
import { absoluteTime, relativeTime, shortSha } from "../lib/format.js";

const dayFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "full",
});

interface DayGroup {
  day: string;
  entries: HistoryEntry[];
}

export function ActivityPage() {
  const params = useParams();
  const project = params.project ?? "";

  const { data: projectDetails } = useProject(project);
  const { data: entries, isLoading, isError, error, refetch } = useHistory(project, { limit: 100 });

  const groupedEntries = useMemo(() => {
    if (!entries || entries.length === 0) return [];

    const groups: DayGroup[] = [];
    let currentDay = "";
    let currentGroup: HistoryEntry[] = [];

    for (const entry of entries) {
      const day = dayFormatter.format(new Date(entry.at));
      if (day !== currentDay) {
        if (currentGroup.length > 0) {
          groups.push({ day: currentDay, entries: currentGroup });
        }
        currentDay = day;
        currentGroup = [entry];
      } else {
        currentGroup.push(entry);
      }
    }

    if (currentGroup.length > 0) {
      groups.push({ day: currentDay, entries: currentGroup });
    }

    return groups;
  }, [entries]);

  const pageTitle = projectDetails?.title ? `${projectDetails.title} Activity` : "Activity";

  if (isLoading) {
    return (
      <Page title={pageTitle} className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="space-y-2">
          <Skeleton className="h-4 w-32 rounded-md" />
          <Skeleton className="h-8 w-48 rounded-lg" />
        </div>
        <div className="mt-8 space-y-8">
          {Array.from({ length: 2 }).map((_, gIdx) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: skeleton items
            <div key={gIdx} className="space-y-4">
              <Skeleton className="h-5 w-40 rounded-md" />
              <div className="rounded-xl border border-border bg-surface divide-y divide-border p-4 space-y-3">
                {Array.from({ length: 3 }).map((_, rIdx) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: skeleton items
                  <div key={rIdx} className="flex items-center justify-between pt-2">
                    <div className="flex items-center gap-3">
                      <Skeleton className="h-7 w-7 rounded-full shrink-0" />
                      <div className="space-y-1">
                        <Skeleton className="h-4 w-48" />
                        <Skeleton className="h-3 w-32" />
                      </div>
                    </div>
                    <Skeleton className="h-6 w-16 rounded-md" />
                  </div>
                ))}
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
        <ErrorState error={error} onRetry={() => void refetch()} />
      </Page>
    );
  }

  if (!entries || entries.length === 0) {
    return (
      <Page title={pageTitle} className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6">
          <div className="flex items-center gap-2 text-xs text-muted">
            <Link to={`/p/${encodeURIComponent(project)}`} className="transition-colors hover:text-fg">
              {projectDetails?.title ?? project}
            </Link>
            <span>/</span>
            <span className="text-fg">Activity</span>
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-fg">Activity</h1>
        </div>
        <EmptyState
          icon={History}
          title="No activity recorded"
          hint="Changes to concepts and files in this project will appear here."
          className="mt-8 py-16"
        />
      </Page>
    );
  }

  return (
    <Page title={pageTitle} className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-2 text-xs text-muted">
          <Link to={`/p/${encodeURIComponent(project)}`} className="transition-colors hover:text-fg">
            {projectDetails?.title ?? project}
          </Link>
          <span>/</span>
          <span className="text-fg">Activity</span>
        </div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-fg">Activity</h1>
        <p className="mt-1 text-sm text-muted">History of commits and updates for {projectDetails?.title ?? project}</p>
      </div>

      {/* Day Groups */}
      <div className="space-y-8">
        {groupedEntries.map((group) => (
          <div key={group.day} className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">{group.day}</h2>

            <div className="overflow-hidden rounded-xl border border-border bg-surface divide-y divide-border">
              {group.entries.map((entry) => {
                const isHuman = entry.actor.startsWith("human:");
                const displayActor = isHuman ? entry.actor.slice(6) : entry.actor;

                return (
                  <div
                    key={entry.sha}
                    className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      <Avatar actor={entry.actor} size={28} className="mt-0.5 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-fg break-words">{entry.subject}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                          <span className="inline-flex items-center gap-1 font-mono text-subtle">
                            {isHuman ? (
                              <User size={12} className="shrink-0 text-muted" />
                            ) : (
                              <Bot size={12} className="shrink-0 text-muted" />
                            )}
                            <span className="truncate max-w-[200px]">{displayActor}</span>
                          </span>

                          {entry.principal && (
                            <span className="font-mono text-xs text-subtle truncate max-w-[200px]">
                              ({entry.principal})
                            </span>
                          )}

                          <span>·</span>
                          <span title={absoluteTime(entry.at)}>{relativeTime(entry.at)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                      <CopyButton value={entry.sha} label={shortSha(entry.sha)} className="font-mono text-xs" />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </Page>
  );
}
