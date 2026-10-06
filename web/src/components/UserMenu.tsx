import { clsx } from "clsx";
import { LogOut } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "../auth/AuthProvider.js";
import { Avatar } from "./Avatar.js";

export function UserMenu({ className }: { className?: string }) {
  const { state, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  if (state.status === "loading") {
    return <div className={clsx("h-7 w-24 rounded-md bg-surface-2 animate-pulse", className)} />;
  }

  const isLocal = state.status === "open";
  const isSignedIn = state.status === "signed-in";
  const version = "config" in state ? state.config.version : null;
  const identity = isSignedIn ? state.identity : null;

  return (
    <div ref={containerRef} className={clsx("relative inline-block", className)}>
      {isLocal ? (
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 ring-1 ring-inset ring-amber-500/20 hover:bg-amber-500/20 transition-colors"
          title="Running in local mode without authentication"
          aria-expanded={open}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
          <span>Local mode · auth off</span>
        </button>
      ) : isSignedIn ? (
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          className="flex items-center gap-2 rounded-lg p-1 text-left hover:bg-surface-2 transition-colors max-w-[200px]"
          aria-expanded={open}
        >
          <Avatar actor={identity ?? "User"} size={26} />
          <span className="truncate text-xs font-medium text-fg">{identity ?? "Signed in"}</span>
        </button>
      ) : null}

      {open && (
        <div
          role="menu"
          className="absolute bottom-full left-0 mb-2 w-56 rounded-xl border border-border bg-surface p-1.5 shadow-xl z-50 text-xs"
        >
          {identity && (
            <div className="px-2.5 py-1.5 border-b border-border mb-1">
              <div className="font-medium text-fg truncate">{identity}</div>
              <div className="text-[11px] text-muted truncate">Identity provider session</div>
            </div>
          )}

          {version && <div className="px-2.5 py-1 text-[11px] text-muted font-mono">ok-fine v{version}</div>}

          {isSignedIn && (
            <>
              <div className="my-1 border-t border-border" />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  logout();
                }}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
              >
                <LogOut size={13} className="shrink-0" />
                <span>Sign out</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
