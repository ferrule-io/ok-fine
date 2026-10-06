import { clsx } from "clsx";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, title, hint, action, className }: EmptyStateProps) {
  return (
    <div
      className={clsx(
        "flex flex-col items-center justify-center p-8 text-center rounded-2xl border border-border bg-surface/50",
        className,
      )}
    >
      {Icon && (
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-surface-2 ring-1 ring-border text-muted">
          <Icon size={24} />
        </div>
      )}
      <h3 className="text-base font-medium text-fg">{title}</h3>
      {hint && <p className="mt-1 text-sm text-muted max-w-sm">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
