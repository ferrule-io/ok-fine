import { clsx } from "clsx";
import { Check, ChevronsUpDown, FolderKanban, HeartPulse, History, LayoutDashboard, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router";
import { useProjects } from "../api/queries.js";
import { DirectoryTree } from "./DirectoryTree.js";
import { Wordmark } from "./Logo.js";
import { SyncPill } from "./SyncPill.js";
import { ThemeToggle } from "./ThemeToggle.js";
import { UserMenu } from "./UserMenu.js";

export interface SidebarProps {
  project?: string;
  drawerOpen: boolean;
  onCloseDrawer: () => void;
}

export function Sidebar({ project, drawerOpen, onCloseDrawer }: SidebarProps) {
  const navigate = useNavigate();
  const projectsQuery = useProjects();
  const [projectSwitcherOpen, setProjectSwitcherOpen] = useState(false);
  const switcherRef = useRef<HTMLDivElement>(null);

  const currentProjectSummary = projectsQuery.data?.find((p) => p.project === project);
  const currentTitle = currentProjectSummary?.title ?? project ?? "All projects";

  // Dismiss project switcher on outside click or escape
  useEffect(() => {
    if (!projectSwitcherOpen) return;

    function handleClickOutside(e: MouseEvent) {
      if (switcherRef.current && !switcherRef.current.contains(e.target as Node)) {
        setProjectSwitcherOpen(false);
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setProjectSwitcherOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [projectSwitcherOpen]);

  const handleSelectProject = (p?: string) => {
    setProjectSwitcherOpen(false);
    onCloseDrawer();
    if (p) {
      navigate(`/p/${encodeURIComponent(p)}`);
    } else {
      navigate("/");
    }
  };

  return (
    <>
      {/* Mobile backdrop */}
      {drawerOpen && (
        <button
          type="button"
          aria-label="Close sidebar"
          onClick={onCloseDrawer}
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-xs lg:hidden animate-[fade-in_150ms_ease-out] cursor-default border-none p-0"
        />
      )}

      {/* Sidebar container */}
      <aside
        className={clsx(
          "fixed inset-y-0 left-0 z-50 w-[272px] bg-surface border-r border-border flex flex-col h-full shadow-2xl lg:shadow-none transition-transform duration-200 ease-out lg:static lg:z-auto lg:translate-x-0",
          drawerOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
        )}
      >
        {/* Header: Wordmark + mobile close */}
        <div className="h-14 border-b border-border flex items-center justify-between px-4 shrink-0">
          <Link to="/" onClick={onCloseDrawer} className="hover:opacity-90 transition-opacity" title="ok-fine home">
            <Wordmark size={22} />
          </Link>

          <button
            type="button"
            onClick={onCloseDrawer}
            aria-label="Close sidebar"
            className="lg:hidden p-1.5 rounded-lg text-muted hover:text-fg hover:bg-surface-2 transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Project switcher dropdown */}
        <div ref={switcherRef} className="relative p-2 border-b border-border shrink-0">
          <button
            type="button"
            onClick={() => setProjectSwitcherOpen((prev) => !prev)}
            aria-expanded={projectSwitcherOpen}
            className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-surface-2 hover:bg-surface border border-border text-xs font-medium text-fg transition-colors cursor-pointer text-left"
          >
            <span className="truncate">{currentTitle}</span>
            <ChevronsUpDown size={14} className="text-subtle shrink-0" />
          </button>

          {projectSwitcherOpen && (
            <div
              role="menu"
              className="absolute left-2 right-2 top-full mt-1 rounded-xl border border-border bg-surface p-1 shadow-xl z-50 text-xs space-y-0.5 max-h-64 overflow-y-auto"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => handleSelectProject()}
                className={clsx(
                  "flex w-full items-center justify-between px-2.5 py-1.5 rounded-lg text-left transition-colors cursor-pointer",
                  !project
                    ? "bg-accent-500/10 text-accent-500 font-medium"
                    : "text-muted hover:text-fg hover:bg-surface-2",
                )}
              >
                <span>All projects</span>
                {!project && <Check size={14} className="shrink-0" />}
              </button>

              <div className="my-1 border-t border-border" />

              {projectsQuery.data?.map((p) => {
                const isSelected = p.project === project;
                return (
                  <button
                    key={p.project}
                    type="button"
                    role="menuitem"
                    onClick={() => handleSelectProject(p.project)}
                    className={clsx(
                      "flex w-full items-center justify-between px-2.5 py-1.5 rounded-lg text-left transition-colors cursor-pointer",
                      isSelected
                        ? "bg-accent-500/10 text-accent-500 font-medium"
                        : "text-muted hover:text-fg hover:bg-surface-2",
                    )}
                  >
                    <div className="truncate pr-2">
                      <div className="font-medium truncate">{p.title}</div>
                      <div className="font-mono text-[10px] text-subtle truncate">{p.project}</div>
                    </div>
                    {isSelected && <Check size={14} className="shrink-0" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Project navigation & Knowledge tree */}
        <div className="flex-1 overflow-y-auto min-h-0 flex flex-col p-2 space-y-4">
          {project ? (
            <>
              {/* Project primary nav items */}
              <nav aria-label="Project sections" className="space-y-0.5">
                <NavLink
                  to={`/p/${encodeURIComponent(project)}`}
                  end
                  onClick={onCloseDrawer}
                  className={({ isActive }) =>
                    clsx(
                      "flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors",
                      isActive ? "bg-surface-2 text-fg" : "text-muted hover:text-fg hover:bg-surface-2",
                    )
                  }
                >
                  <LayoutDashboard size={14} className="text-muted" />
                  <span>Overview</span>
                </NavLink>

                <NavLink
                  to={`/p/${encodeURIComponent(project)}/activity`}
                  onClick={onCloseDrawer}
                  className={({ isActive }) =>
                    clsx(
                      "flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors",
                      isActive ? "bg-surface-2 text-fg" : "text-muted hover:text-fg hover:bg-surface-2",
                    )
                  }
                >
                  <History size={14} className="text-muted" />
                  <span>Activity</span>
                </NavLink>

                <NavLink
                  to={`/p/${encodeURIComponent(project)}/health`}
                  onClick={onCloseDrawer}
                  className={({ isActive }) =>
                    clsx(
                      "flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors",
                      isActive ? "bg-surface-2 text-fg" : "text-muted hover:text-fg hover:bg-surface-2",
                    )
                  }
                >
                  <HeartPulse size={14} className="text-muted" />
                  <span>Health</span>
                </NavLink>

                <NavLink
                  to={`/search?project=${encodeURIComponent(project)}`}
                  onClick={onCloseDrawer}
                  className={({ isActive }) =>
                    clsx(
                      "flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors",
                      isActive ? "bg-surface-2 text-fg" : "text-muted hover:text-fg hover:bg-surface-2",
                    )
                  }
                >
                  <Search size={14} className="text-muted" />
                  <span>Search</span>
                </NavLink>
              </nav>

              {/* Knowledge tree */}
              <div className="flex-1 min-h-0 flex flex-col">
                <div className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-subtle select-none">
                  Knowledge
                </div>
                <div className="flex-1 min-h-0">
                  <DirectoryTree project={project} />
                </div>
              </div>
            </>
          ) : (
            /* Global navigation when no project selected */
            <div className="space-y-3">
              <nav aria-label="Global navigation" className="space-y-0.5">
                <NavLink
                  to="/"
                  end
                  onClick={onCloseDrawer}
                  className={({ isActive }) =>
                    clsx(
                      "flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors",
                      isActive ? "bg-surface-2 text-fg" : "text-muted hover:text-fg hover:bg-surface-2",
                    )
                  }
                >
                  <LayoutDashboard size={14} className="text-muted" />
                  <span>Projects</span>
                </NavLink>

                <NavLink
                  to="/search"
                  onClick={onCloseDrawer}
                  className={({ isActive }) =>
                    clsx(
                      "flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors",
                      isActive ? "bg-surface-2 text-fg" : "text-muted hover:text-fg hover:bg-surface-2",
                    )
                  }
                >
                  <Search size={14} className="text-muted" />
                  <span>Search</span>
                </NavLink>
              </nav>

              {projectsQuery.data && projectsQuery.data.length > 0 && (
                <div className="pt-2">
                  <div className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-subtle select-none">
                    Projects
                  </div>
                  <div className="space-y-0.5">
                    {projectsQuery.data.map((p) => (
                      <Link
                        key={p.project}
                        to={`/p/${encodeURIComponent(p.project)}`}
                        onClick={onCloseDrawer}
                        className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-muted hover:text-fg hover:bg-surface-2 transition-colors"
                      >
                        <FolderKanban size={14} className="text-accent-500 shrink-0" />
                        <span className="truncate">{p.title}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer: SyncPill, ThemeToggle, UserMenu */}
        <div className="p-3 border-t border-border flex flex-col gap-2.5 mt-auto bg-surface shrink-0">
          <div className="flex items-center justify-between gap-2">
            <SyncPill />
            <ThemeToggle />
          </div>
          <div className="flex items-center justify-between gap-2">
            <UserMenu />
          </div>
        </div>
      </aside>
    </>
  );
}
