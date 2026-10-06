import { clsx } from "clsx";
import { HardDrive } from "lucide-react";
import { useSyncStatus } from "../api/queries.js";
import { relativeTime } from "../lib/format.js";

export interface SyncPillProps {
  className?: string;
}

export function SyncPill({ className }: SyncPillProps) {
  const { data, isLoading } = useSyncStatus();

  if (isLoading || !data) {
    return (
      <span
        className={clsx(
          "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium bg-zinc-500/10 text-zinc-500 ring-1 ring-inset ring-zinc-500/20",
          className,
        )}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-zinc-400 animate-pulse" />
        <span>Syncing...</span>
      </span>
    );
  }

  if (data.remote === null) {
    return (
      <span
        className={clsx(
          "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 ring-1 ring-inset ring-zinc-500/20",
          className,
        )}
      >
        <HardDrive size={12} className="shrink-0" />
        <span>Local only</span>
      </span>
    );
  }

  if (data.lastError) {
    return (
      <span
        title={data.lastError}
        className={clsx(
          "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium bg-rose-500/10 text-rose-600 dark:text-rose-400 ring-1 ring-inset ring-rose-500/20",
          className,
        )}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-rose-500 shrink-0" />
        <span className="truncate max-w-[120px]">Sync error</span>
      </span>
    );
  }

  if (data.ahead > 0 || data.behind > 0) {
    return (
      <span
        className={clsx(
          "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 ring-1 ring-inset ring-amber-500/20 font-mono",
          className,
        )}
      >
        <span>
          ↑{data.ahead} ↓{data.behind}
        </span>
      </span>
    );
  }

  const timeLabel = data.lastSyncAt ? relativeTime(data.lastSyncAt) : "just now";

  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 ring-1 ring-inset ring-emerald-500/20",
        className,
      )}
    >
      <span className="relative flex h-2 w-2 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
      </span>
      <span>Synced {timeLabel}</span>
    </span>
  );
}
