import { Menu, Search } from "lucide-react";
import { Breadcrumbs } from "./Breadcrumbs.js";
import { useCommandPalette } from "./CommandPalette.js";

export interface TopBarProps {
  onMenuClick?: () => void;
}

export function TopBar({ onMenuClick }: TopBarProps) {
  const { open } = useCommandPalette();

  return (
    <header className="sticky top-0 z-30 h-14 bg-bg/70 backdrop-blur-xl border-b border-border flex items-center justify-between px-4 gap-4 shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        <button
          type="button"
          onClick={onMenuClick}
          aria-label="Open sidebar menu"
          className="lg:hidden p-1.5 -ml-1 rounded-lg text-muted hover:text-fg hover:bg-surface-2 transition-colors cursor-pointer shrink-0"
        >
          <Menu size={18} />
        </button>
        <Breadcrumbs />
      </div>

      <button
        type="button"
        onClick={open}
        className="inline-flex items-center gap-2 px-2.5 py-1 rounded-lg bg-surface-2 hover:bg-surface border border-border hover:border-border-strong text-xs transition-colors cursor-pointer shrink-0"
        title="Search knowledge base (⌘K or /)"
      >
        <Search size={13} className="text-muted shrink-0" />
        <span className="text-muted hidden sm:inline">Search knowledge…</span>
        <kbd className="hidden sm:inline-block font-mono text-[10px] text-subtle bg-surface px-1.5 py-0.5 rounded border border-border">
          ⌘K
        </kbd>
      </button>
    </header>
  );
}
