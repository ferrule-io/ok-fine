import { useAuth } from "../auth/AuthProvider.js";
import { Logo } from "../components/Logo.js";
import { Page } from "../components/Page.js";

export function ForbiddenPage() {
  const { state, logout } = useAuth();
  const scope = state.status === "forbidden" ? state.scope : "config" in state ? state.config.scope : "okf:read";

  return (
    <Page title="Forbidden" className="min-h-screen flex items-center justify-center p-6 bg-bg">
      <div className="w-full max-w-md rounded-2xl border border-border-strong bg-surface p-8 shadow-[0_30px_80px_-20px_rgb(139_92_246/0.35)] ring-1 ring-border-strong text-center flex flex-col items-center">
        <Logo size={44} className="mb-3" />
        <h1 className="text-2xl font-semibold tracking-tight text-fg">ok-fine</h1>
        <h2 className="mt-2 text-base font-medium text-fg">Access denied</h2>
        <p className="mt-3 text-sm text-muted">
          Your account can't read this knowledge base (needs{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-fg">{scope}</code>
          ).
        </p>

        <button
          type="button"
          onClick={logout}
          className="mt-6 w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm font-medium text-fg transition hover:bg-surface-2 focus-visible:outline-2 outline-accent-500 cursor-pointer"
        >
          Sign out
        </button>

        <p className="mt-4 text-xs text-subtle">Sign in with an account that has read permissions.</p>
      </div>
    </Page>
  );
}
