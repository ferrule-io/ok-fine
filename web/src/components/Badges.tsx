import { clsx } from "clsx";
import { BadgeCheck, CircleDashed, Clock, GitPullRequestDraft, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { TypeIcon } from "./TypeIcon.js";

export interface PillProps {
  className?: string;
  children: ReactNode;
}

export function Pill({ className, children }: PillProps) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        className,
      )}
    >
      {children}
    </span>
  );
}

export interface StatusBadgeProps {
  status: string;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const norm = status.toLowerCase();
  let color = "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 ring-zinc-500/20";

  if (norm === "draft") {
    color = "bg-amber-500/10 text-amber-600 dark:text-amber-400 ring-amber-500/20";
  } else if (norm === "stable") {
    color = "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 ring-emerald-500/20";
  } else if (norm === "deprecated") {
    color = "bg-rose-500/10 text-rose-600 dark:text-rose-400 ring-rose-500/20";
  }

  return <Pill className={clsx(color, className)}>{status}</Pill>;
}

export interface TrustBadgeProps {
  tier: string;
  className?: string;
}

export function TrustBadge({ tier, className }: TrustBadgeProps) {
  const norm = tier.toLowerCase();

  if (norm === "human-reviewed") {
    return (
      <Pill className={clsx("bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 ring-emerald-500/20", className)}>
        <ShieldCheck size={12} className="shrink-0" />
        <span>human-reviewed</span>
      </Pill>
    );
  }

  if (norm === "machine-confirmed") {
    return (
      <Pill className={clsx("bg-sky-500/10 text-sky-600 dark:text-sky-400 ring-sky-500/20", className)}>
        <BadgeCheck size={12} className="shrink-0" />
        <span>machine-confirmed</span>
      </Pill>
    );
  }

  if (norm === "proposed") {
    return (
      <Pill className={clsx("bg-violet-500/10 text-violet-600 dark:text-violet-400 ring-violet-500/20", className)}>
        <GitPullRequestDraft size={12} className="shrink-0" />
        <span>proposed</span>
      </Pill>
    );
  }

  return (
    <Pill className={clsx("bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 ring-zinc-500/20", className)}>
      <CircleDashed size={12} className="shrink-0" />
      <span>{tier || "unverified"}</span>
    </Pill>
  );
}

export interface StaleBadgeProps {
  className?: string;
}

export function StaleBadge({ className }: StaleBadgeProps) {
  return (
    <Pill className={clsx("bg-orange-500/10 text-orange-600 dark:text-orange-400 ring-orange-500/20", className)}>
      <Clock size={12} className="shrink-0" />
      <span>Stale</span>
    </Pill>
  );
}

export interface TypeBadgeProps {
  type: string | null;
  className?: string;
}

export function TypeBadge({ type, className }: TypeBadgeProps) {
  return (
    <Pill className={clsx("bg-surface-2 text-fg ring-border", className)}>
      <TypeIcon type={type} size={12} />
      <span>{type || "Concept"}</span>
    </Pill>
  );
}
