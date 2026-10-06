import { clsx } from "clsx";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";

export interface StatCardProps {
  label: string;
  icon?: LucideIcon;
  value?: ReactNode;
  tone?: "default" | "warn";
  to?: string;
  children?: ReactNode;
  className?: string;
}

export function StatCard({ label, icon: Icon, value, tone = "default", to, children, className }: StatCardProps) {
  const isWarn = tone === "warn";
  const containerClasses = clsx(
    "rounded-xl border p-4 transition-all",
    isWarn ? "border-orange-500/30 bg-orange-500/5 dark:border-orange-500/20" : "border-border bg-surface",
    to && "block hover:-translate-y-px hover:border-border-strong",
    className,
  );

  const content = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wider text-muted">{label}</span>
        {Icon && <Icon size={16} className={isWarn ? "text-orange-600 dark:text-orange-400" : "text-muted shrink-0"} />}
      </div>
      {value !== undefined && (
        <div
          className={clsx(
            "mt-2 text-2xl font-semibold tracking-tight",
            isWarn ? "text-orange-600 dark:text-orange-400" : "text-fg",
          )}
        >
          {value}
        </div>
      )}
      {children && <div className="mt-3">{children}</div>}
    </>
  );

  if (to) {
    return (
      <Link to={to} className={containerClasses}>
        {content}
      </Link>
    );
  }

  return <div className={containerClasses}>{content}</div>;
}
