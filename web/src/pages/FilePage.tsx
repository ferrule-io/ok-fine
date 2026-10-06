import { Download } from "lucide-react";
import { useParams } from "react-router";
import { useFile } from "../api/queries.js";
import { CodeBlock } from "../components/CodeBlock.js";
import { CopyButton } from "../components/CopyButton.js";
import { EmptyState } from "../components/EmptyState.js";
import { ErrorState } from "../components/ErrorState.js";
import { Page } from "../components/Page.js";
import { Skeleton } from "../components/Skeleton.js";
import { languageForPath } from "../lib/fileLang.js";

export function FilePage() {
  const params = useParams();
  const project = params.project ?? "";
  const path = params["*"] ?? "";

  const { data, isLoading, error, refetch } = useFile(project, path);

  const filename = path.split("/").pop() ?? path;
  const pageTitle = filename ? `${filename} · ${project}` : "File";

  if (isLoading) {
    return (
      <Page title={pageTitle} className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-border pb-4">
          <div className="space-y-2">
            <Skeleton className="h-6 w-64 rounded-md" />
            <Skeleton className="h-4 w-28 rounded-md" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-8 w-24 rounded-md" />
            <Skeleton className="h-8 w-28 rounded-md" />
          </div>
        </div>
        <Skeleton className="h-96 w-full rounded-xl" />
      </Page>
    );
  }

  if (error) {
    return (
      <Page title={pageTitle} className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        <ErrorState error={error} onRetry={refetch} fullScreen />
      </Page>
    );
  }

  if (!data) {
    return (
      <Page title={pageTitle} className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        <EmptyState title="File not found" hint={`Could not find file "${path}" in project "${project}".`} />
      </Page>
    );
  }

  const handleDownload = () => {
    const blob = new Blob([data.content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename || "file";
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  const lang = languageForPath(path);

  return (
    <Page title={pageTitle} className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-border pb-4">
        <div className="space-y-1.5 min-w-0">
          <h1 className="font-mono text-xl font-semibold text-fg break-all">{path}</h1>
          {data.revision && (
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs px-2 py-0.5 rounded-md bg-surface-2 border border-border text-muted">
                rev: {data.revision.slice(0, 8)}
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <CopyButton value={data.content} label="Copy content" />
          <button
            type="button"
            onClick={handleDownload}
            aria-label="Download file"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-fg focus-visible:outline-2 outline-accent-500 cursor-pointer"
          >
            <Download size={14} className="shrink-0 text-muted" />
            <span>Download</span>
          </button>
        </div>
      </div>

      <CodeBlock
        code={data.content}
        lang={lang}
        lineNumbers
        className="rounded-xl border border-border bg-surface-2 overflow-hidden shadow-xs"
      />
    </Page>
  );
}
