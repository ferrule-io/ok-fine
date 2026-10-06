import { useAuth } from "../auth/AuthProvider.js";
import { CopyButton } from "../components/CopyButton.js";
import { Logo } from "../components/Logo.js";
import { Page } from "../components/Page.js";

export function NotConfiguredPage() {
  const { state } = useAuth();
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const redirectUri = state.status === "unconfigured" ? state.redirectUri : `${origin}/ui/callback`;
  const scope = "config" in state ? state.config.scope : "okf:read";
  const resource = "discovery" in state ? state.discovery.resource : `${origin}/mcp`;

  return (
    <Page title="Sign-in not configured" className="min-h-screen flex items-center justify-center p-6 bg-bg">
      <div className="w-full max-w-lg rounded-2xl border border-border-strong bg-surface p-8 shadow-[0_30px_80px_-20px_rgb(139_92_246/0.35)] ring-1 ring-border-strong flex flex-col items-center">
        <Logo size={44} className="mb-3" />
        <h1 className="text-2xl font-semibold tracking-tight text-fg">ok-fine</h1>
        <h2 className="mt-2 text-base font-medium text-fg">Sign-in isn't configured</h2>
        <p className="mt-2 text-sm text-muted text-center">
          The web UI needs a public OAuth 2.0 client. Set{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-fg">OAUTH_UI_CLIENT_ID</code> (Helm{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-fg">oauth.uiClientId</code>) with
          these parameters:
        </p>

        <div className="mt-6 w-full space-y-3 text-left">
          <div className="rounded-xl border border-border bg-surface-2 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted">Redirect URI</span>
              <CopyButton value={redirectUri} />
            </div>
            <div className="mt-1 font-mono text-xs text-fg break-all">{redirectUri}</div>
          </div>

          <div className="rounded-xl border border-border bg-surface-2 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted">Web origin</span>
              <CopyButton value={origin} />
            </div>
            <div className="mt-1 font-mono text-xs text-fg break-all">{origin}</div>
          </div>

          <div className="rounded-xl border border-border bg-surface-2 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted">Scope</span>
              <CopyButton value={scope} />
            </div>
            <div className="mt-1 font-mono text-xs text-fg break-all">{scope}</div>
          </div>

          <div className="rounded-xl border border-border bg-surface-2 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted">Resource</span>
              <CopyButton value={resource} />
            </div>
            <div className="mt-1 font-mono text-xs text-fg break-all">{resource}</div>
          </div>
        </div>

        <p className="mt-6 text-xs text-subtle text-center">
          Alternatively, your identity provider must advertise dynamic client registration.
        </p>
      </div>
    </Page>
  );
}
