import { clsx } from "clsx";
import { AlertCircle, FileQuestion } from "lucide-react";
import { Link } from "react-router";
import { ApiError } from "../api/client.js";
import { EmptyState } from "./EmptyState.js";

export interface ErrorStateProps {
  error: unknown;
  onRetry?: () => void;
  fullScreen?: boolean;
  className?: string;
}

export function ErrorState({ error, onRetry, fullScreen = false, className }: ErrorStateProps) {
  const isNotFound = error instanceof ApiError && (error.code === "project_not_found" || error.code === "not_found");
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "An unexpected error occurred.";

  const content = isNotFound ? (
    <EmptyState
      icon={FileQuestion}
      title="Not found"
      hint="The requested project, concept, or file could not be found."
      action={
        <Link
          to="/"
          className="inline-flex items-center justify-center rounded-lg bg-accent-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-600 focus-visible:outline-2 outline-accent-500"
        >
          Back to all projects
        </Link>
      }
    />
  ) : (
    <div className="flex flex-col items-center justify-center p-8 text-center rounded-2xl border border-rose-500/20 bg-rose-500/5 max-w-lg mx-auto">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400 ring-1 ring-rose-500/20">
        <AlertCircle size={24} />
      </div>
      <h3 className="text-base font-medium text-fg">Something went wrong</h3>
      <p className="mt-1 text-sm text-muted break-words max-w-sm">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 inline-flex items-center justify-center rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-fg transition-colors hover:bg-surface-2 focus-visible:outline-2 outline-accent-500"
        >
          Retry
        </button>
      )}
    </div>
  );

  if (fullScreen) {
    return (
      <div className={clsx("flex min-h-[60vh] items-center justify-center p-6", className)}>
        <div className="w-full max-w-md">{content}</div>
      </div>
    );
  }

  return <div className={className}>{content}</div>;
}
