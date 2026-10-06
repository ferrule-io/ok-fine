import { Link } from "react-router";
import { Page } from "../components/Page.js";

export function NotFoundPage() {
  return (
    <Page title="Page not found" className="flex min-h-[70vh] flex-col items-center justify-center p-8 text-center">
      <div className="text-8xl font-black tracking-tighter bg-gradient-to-br from-accent-500 via-accent-400 to-glow bg-clip-text text-transparent select-none">
        404
      </div>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight text-fg">Nothing here</h1>
      <p className="mt-2 text-sm text-muted max-w-sm">
        The page you're looking for doesn't exist, has been moved, or you don't have access to it.
      </p>
      <Link
        to="/"
        className="mt-6 inline-flex items-center justify-center rounded-lg bg-surface-2 px-4 py-2 text-xs font-medium text-fg ring-1 ring-border hover:bg-surface hover:ring-border-strong transition-colors"
      >
        Back to projects
      </Link>
    </Page>
  );
}
