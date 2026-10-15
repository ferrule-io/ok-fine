import { type FormEvent, useState } from "react";
import { useAuth } from "../auth/AuthProvider.js";
import { currentReturnTo } from "../auth/returnTo.js";
import { Logo } from "../components/Logo.js";
import { Page } from "../components/Page.js";

export function SignInPage({ error }: { error?: string }) {
  const { state, login, signInWithApiKey } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);

  const isApiKeyMode = state.status === "signed-out" && state.config.authMode === "api_key";

  let issuerHost = "identity provider";
  if (state.status === "signed-out" && state.discovery) {
    try {
      issuerHost = new URL(state.discovery.as.issuer).host;
    } catch {
      issuerHost = state.discovery.as.issuer;
    }
  }

  const errMessage = submitError ?? error ?? (state.status === "signed-out" ? state.error : undefined);

  const handleSignIn = async () => {
    try {
      setSubmitting(true);
      await login(currentReturnTo());
    } catch {
      setSubmitting(false);
    }
  };

  const handleApiKeySubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = apiKey.trim();
    if (!trimmed) return;
    try {
      setSubmitting(true);
      setSubmitError(null);
      await signInWithApiKey(trimmed);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to authenticate");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Page title="Sign in" className="min-h-screen flex items-center justify-center p-6 bg-bg">
      <div className="w-full max-w-md rounded-2xl border border-border-strong bg-surface p-8 shadow-[0_30px_80px_-20px_rgb(139_92_246/0.35)] ring-1 ring-border-strong text-center flex flex-col items-center">
        <Logo size={44} className="mb-3" />
        <h1 className="text-2xl font-semibold tracking-tight text-fg">ok-fine</h1>
        <p className="mt-2 text-sm text-muted">Shared knowledge for your agents and your team.</p>

        {errMessage ? (
          <div className="mt-6 w-full rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-left text-sm text-rose-600 dark:text-rose-400 break-words">
            {errMessage}
          </div>
        ) : state.status === "signed-out" && state.reason === "expired" ? (
          <div className="mt-6 w-full rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-600 dark:text-amber-400">
            Your session expired.
          </div>
        ) : state.status === "signed-out" && state.reason === "signed-out" ? (
          <div className="mt-6 w-full rounded-xl border border-border bg-surface-2 px-4 py-3 text-sm text-muted">
            You've signed out.
          </div>
        ) : null}

        {isApiKeyMode ? (
          <>
            <form onSubmit={handleApiKeySubmit} className="mt-6 w-full flex flex-col gap-4 text-left">
              <div>
                <label htmlFor="api-key" className="block text-xs font-medium text-fg mb-1.5">
                  API Key
                </label>
                <input
                  id="api-key"
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Paste your API key…"
                  autoComplete="current-password"
                  required
                  disabled={submitting}
                  className="w-full rounded-xl border border-border bg-surface-2 px-4 py-2.5 text-sm text-fg placeholder:text-muted transition-colors focus-visible:outline-2 outline-accent-500 font-mono disabled:opacity-50"
                />
              </div>

              <button
                type="submit"
                disabled={submitting || !apiKey.trim()}
                className="w-full rounded-xl bg-gradient-to-r from-accent-500 to-accent-600 px-4 py-3 text-sm font-medium text-white shadow-sm transition hover:from-accent-600 hover:to-accent-700 focus-visible:outline-2 outline-accent-500 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed text-center"
              >
                {submitting ? "Signing in…" : "Sign in"}
              </button>
            </form>

            <p className="mt-4 text-xs text-subtle">Read-only view · authenticated via API key</p>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={handleSignIn}
              disabled={submitting}
              className="mt-6 w-full rounded-xl bg-gradient-to-r from-accent-500 to-accent-600 px-4 py-3 text-sm font-medium text-white shadow-sm transition hover:from-accent-600 hover:to-accent-700 focus-visible:outline-2 outline-accent-500 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? "Redirecting…" : `Continue with ${issuerHost}`}
            </button>

            <p className="mt-4 text-xs text-subtle">
              Read-only view · signs in through your organization's identity provider
            </p>
          </>
        )}
      </div>
    </Page>
  );
}
