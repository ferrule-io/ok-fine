import { clsx } from "clsx";
import { Command } from "cmdk";
import { FolderKanban, Search } from "lucide-react";
import { createContext, useContext, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useProjects, useSearch } from "../api/queries.js";
import { conceptUrl } from "../lib/links.js";
import { getRecent } from "../lib/recent.js";
import { Highlighted } from "./Highlighted.js";
import { TypeIcon } from "./TypeIcon.js";

export interface CommandPaletteContextValue {
  open(): void;
}

export const CommandPaletteContext = createContext<CommandPaletteContextValue | null>(null);

export function useCommandPalette(): CommandPaletteContextValue {
  const ctx = useContext(CommandPaletteContext);
  if (!ctx) {
    throw new Error("useCommandPalette must be used within CommandPaletteContext.Provider");
  }
  return ctx;
}

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentProject?: string;
}

function trustDotColor(tier?: string): string {
  const norm = tier?.toLowerCase();
  if (norm === "human-reviewed") return "bg-emerald-500";
  if (norm === "machine-confirmed") return "bg-sky-500";
  return "bg-zinc-400 dark:bg-zinc-600";
}

export function CommandPalette({ open, onOpenChange, currentProject }: CommandPaletteProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [scoped, setScoped] = useState(Boolean(currentProject));
  const [selected, setSelected] = useState("");

  // Sync scoped state when project changes
  useEffect(() => {
    setScoped(Boolean(currentProject));
  }, [currentProject]);

  // Debounce query by 150ms
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
    }, 150);
    return () => clearTimeout(timer);
  }, [query]);

  // Global keyboard shortcuts: Cmd+K / Ctrl+K and '/'
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        onOpenChange(!open);
        return;
      }
      if (e.key === "/" && !open) {
        const target = e.target as HTMLElement | null;
        const isInput =
          target &&
          (target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.tagName === "SELECT" ||
            target.isContentEditable ||
            target.closest("input, textarea, select, [contenteditable]"));
        if (!isInput) {
          e.preventDefault();
          onOpenChange(true);
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onOpenChange]);

  const projectsQuery = useProjects();
  const recentItems = open ? getRecent() : [];

  const shouldSearch = debouncedQuery.trim().length >= 2;
  const targetProject = scoped && currentProject ? currentProject : undefined;
  const searchQuery = useSearch(
    {
      q: debouncedQuery.trim(),
      project: targetProject,
      limit: 20,
    },
    shouldSearch && open,
  );

  // cmdk can't auto-select items that arrive asynchronously with shouldFilter=false; select the first row.
  const firstHit = shouldSearch ? searchQuery.data?.[0] : undefined;
  const firstRecent = recentItems[0];
  const firstProject = projectsQuery.data?.[0];
  let firstValue = "";
  if (firstHit) firstValue = `hit-${firstHit.project}-${firstHit.id}`;
  else if (debouncedQuery.trim().length > 0) firstValue = "search-all-results";
  else if (firstRecent) firstValue = `recent-${firstRecent.project}-${firstRecent.id}`;
  else if (firstProject) firstValue = `proj-${firstProject.project}`;
  useEffect(() => {
    setSelected(firstValue);
  }, [firstValue]);

  const handleSelect = (url: string) => {
    onOpenChange(false);
    setQuery("");
    navigate(url);
  };

  const handleScopeToggle = () => {
    if (currentProject) {
      setScoped((prev) => !prev);
    }
  };

  return (
    <Command.Dialog
      value={selected}
      onValueChange={setSelected}
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);
        if (!nextOpen) {
          setQuery("");
        }
      }}
      label="Search concepts, projects…"
      shouldFilter={false}
      overlayClassName="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 animate-[okf-fade-in_120ms_ease-out]"
      contentClassName="fixed left-1/2 top-[15%] -translate-x-1/2 w-full max-w-xl z-50 p-3 outline-none"
      className="w-full bg-surface border border-border-strong rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[70vh] text-fg animate-[okf-scale-in_120ms_ease-out]"
    >
      {/* Header with input and scope chip */}
      <div className="flex items-center gap-2 px-3 border-b border-border">
        <Search size={16} className="text-muted shrink-0" />
        <Command.Input
          value={query}
          onValueChange={setQuery}
          placeholder="Search concepts, projects…"
          className="w-full bg-transparent py-3 text-sm text-fg placeholder:text-muted outline-none"
        />

        <button
          type="button"
          onClick={handleScopeToggle}
          disabled={!currentProject}
          className={clsx(
            "shrink-0 text-xs px-2.5 py-1 rounded-md font-medium transition-colors select-none",
            currentProject
              ? scoped
                ? "bg-accent-500/10 text-accent-500 ring-1 ring-accent-500/20 hover:bg-accent-500/20 cursor-pointer"
                : "bg-surface-2 text-muted ring-1 ring-border hover:text-fg cursor-pointer"
              : "bg-surface-2 text-muted/60 ring-1 ring-border cursor-default",
          )}
          title={currentProject ? "Click to toggle search scope" : undefined}
        >
          {scoped && currentProject ? "This project" : "All projects"}
        </button>
      </div>

      {/* Results / Empty lists */}
      <Command.List className="overflow-y-auto max-h-[380px] p-2 space-y-1">
        {shouldSearch && searchQuery.isLoading && (
          <Command.Loading className="px-4 py-8 text-center text-xs text-subtle">Searching...</Command.Loading>
        )}

        {shouldSearch && !searchQuery.isLoading && searchQuery.data && searchQuery.data.length === 0 && (
          <Command.Empty className="px-4 py-8 text-center text-xs text-subtle">
            No matching concepts or files
          </Command.Empty>
        )}

        {/* 1. Results when query is active (2+ chars) */}
        {shouldSearch && searchQuery.data && searchQuery.data.length > 0 && (
          <Command.Group
            heading="Concepts & Files"
            className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-subtle [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider"
          >
            {searchQuery.data.map((hit) => (
              <Command.Item
                key={`${hit.project}/${hit.id}`}
                value={`hit-${hit.project}-${hit.id}`}
                onSelect={() => handleSelect(conceptUrl(hit.project, hit.id))}
                className="flex flex-col gap-1 px-2.5 py-2 rounded-lg text-xs cursor-pointer data-[selected=true]:bg-surface-2 data-[selected=true]:text-fg transition-colors"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <TypeIcon type={hit.type} size={14} />
                  <span className="font-medium text-fg truncate">{hit.title}</span>
                  <span className="font-mono text-[11px] text-subtle truncate">
                    {hit.project}/{hit.id}
                  </span>
                  <span
                    className={clsx("ml-auto h-2 w-2 rounded-full shrink-0", trustDotColor(hit.trustTier))}
                    title={hit.trustTier}
                  />
                </div>

                {hit.snippet && (
                  <div className="text-[11px] text-muted truncate pl-5">
                    <Highlighted text={hit.snippet} query={debouncedQuery} />
                  </div>
                )}
              </Command.Item>
            ))}
          </Command.Group>
        )}

        {/* 2. Empty query: Recent and Projects */}
        {!shouldSearch && (
          <>
            {recentItems.length > 0 && (
              <Command.Group
                heading="Recent"
                className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-subtle [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider"
              >
                {recentItems.map((item) => (
                  <Command.Item
                    key={`recent-${item.project}-${item.id}`}
                    value={`recent-${item.project}-${item.id}`}
                    onSelect={() => handleSelect(conceptUrl(item.project, item.id))}
                    className="flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs cursor-pointer data-[selected=true]:bg-surface-2 data-[selected=true]:text-fg transition-colors"
                  >
                    <TypeIcon type={item.type} size={14} />
                    <span className="font-medium text-fg truncate">{item.title}</span>
                    <span className="ml-auto font-mono text-[11px] text-subtle shrink-0">
                      {item.project}/{item.id}
                    </span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {projectsQuery.data && projectsQuery.data.length > 0 && (
              <Command.Group
                heading="Projects"
                className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-subtle [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider"
              >
                {projectsQuery.data.map((p) => (
                  <Command.Item
                    key={`proj-${p.project}`}
                    value={`proj-${p.project}`}
                    onSelect={() => handleSelect(`/p/${encodeURIComponent(p.project)}`)}
                    className="flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs cursor-pointer data-[selected=true]:bg-surface-2 data-[selected=true]:text-fg transition-colors"
                  >
                    <FolderKanban size={14} className="text-accent-500 shrink-0" />
                    <span className="font-medium text-fg truncate">{p.title}</span>
                    <span className="ml-auto font-mono text-[11px] text-subtle shrink-0">{p.project}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}
          </>
        )}

        {/* 3. Final item: Search all results */}
        {debouncedQuery.trim().length > 0 && (
          <Command.Group className="pt-1 border-t border-border mt-1">
            <Command.Item
              value="search-all-results"
              onSelect={() => {
                const params = new URLSearchParams();
                params.set("q", debouncedQuery.trim());
                if (scoped && currentProject) {
                  params.set("project", currentProject);
                }
                handleSelect(`/search?${params.toString()}`);
              }}
              className="flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs cursor-pointer text-muted hover:text-fg data-[selected=true]:bg-surface-2 data-[selected=true]:text-fg transition-colors"
            >
              <Search size={14} className="shrink-0 text-muted" />
              <span>
                Search all results for “<strong className="text-fg font-medium">{debouncedQuery.trim()}</strong>”
              </span>
            </Command.Item>
          </Command.Group>
        )}
      </Command.List>

      {/* Footer hints */}
      <div className="flex items-center gap-3 px-3.5 py-2 border-t border-border text-[11px] text-subtle bg-surface-2/40 select-none">
        <span className="flex items-center gap-1">
          <kbd className="font-mono bg-surface px-1 py-0.2 rounded border border-border">↑↓</kbd> navigate
        </span>
        <span className="flex items-center gap-1">
          <kbd className="font-mono bg-surface px-1 py-0.2 rounded border border-border">↵</kbd> open
        </span>
        <span className="flex items-center gap-1">
          <kbd className="font-mono bg-surface px-1 py-0.2 rounded border border-border">esc</kbd> close
        </span>
      </div>
    </Command.Dialog>
  );
}
