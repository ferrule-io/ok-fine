import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Outlet, useLocation, useParams } from "react-router";
import { CommandPalette, CommandPaletteContext } from "./CommandPalette.js";
import { Sidebar } from "./Sidebar.js";
import { TopBar } from "./TopBar.js";
import { TreeStateContext } from "./TreeState.js";

export function AppShell() {
  const { project } = useParams<{ project?: string }>();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  // Reset tree expansion when active project changes
  const prevProjectRef = useRef(project);
  useEffect(() => {
    if (prevProjectRef.current !== project) {
      prevProjectRef.current = project;
      setExpanded(new Set());
    }
  }, [project]);
  // Close mobile drawer on navigation
  const { pathname } = useLocation();
  useEffect(() => {
    if (pathname) {
      setDrawerOpen(false);
    }
  }, [pathname]);

  const toggle = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const reveal = useCallback((path: string) => {
    // 1. Expand the path and all its ancestor directories
    setExpanded((prev) => {
      const next = new Set(prev);
      const segments = path.split("/");
      let current = "";
      for (const seg of segments) {
        if (!seg) continue;
        current = current ? `${current}/${seg}` : seg;
        next.add(current);
      }
      return next;
    });

    // 2. Open drawer under lg breakpoint
    setDrawerOpen(true);

    // 3. Scroll row into view
    requestAnimationFrame(() => {
      try {
        const el = document.querySelector(`[data-tree-path="${CSS.escape(path)}"]`);
        el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      } catch {
        // Fallback if CSS.escape fails on special characters
        const el = document.querySelector(`[data-tree-path]`);
        el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    });
  }, []);

  const treeStateValue = useMemo(
    () => ({
      expanded,
      toggle,
      reveal,
    }),
    [expanded, toggle, reveal],
  );

  const commandPaletteValue = useMemo(
    () => ({
      open: () => setCommandPaletteOpen(true),
    }),
    [],
  );

  return (
    <TreeStateContext.Provider value={treeStateValue}>
      <CommandPaletteContext.Provider value={commandPaletteValue}>
        <div className="flex h-screen w-screen overflow-hidden text-fg">
          <Sidebar project={project} drawerOpen={drawerOpen} onCloseDrawer={() => setDrawerOpen(false)} />

          <div className="flex flex-1 flex-col min-w-0 h-full overflow-hidden">
            <TopBar onMenuClick={() => setDrawerOpen(true)} />
            <main className="flex-1 overflow-y-auto min-h-0">
              <Outlet />
            </main>
          </div>
        </div>

        <CommandPalette open={commandPaletteOpen} onOpenChange={setCommandPaletteOpen} currentProject={project} />
      </CommandPaletteContext.Provider>
    </TreeStateContext.Provider>
  );
}
