import { useState } from "react";
import { useAuth } from "../auth/AuthProvider.js";
import { currentReturnTo } from "../auth/returnTo.js";
import { Logo } from "../components/Logo.js";
import { Page } from "../components/Page.js";

export function SignInPage({ error }: { error?: string }) {
  const { state, login } = useAuth();
  const [submitting, setSubmitting] = useState(false);

  let issuerHost = "identity provider";
  if (state.status === "signed-out") {
    try {
      issuerHost = new URL(state.discovery.as.issuer).host;
    } catch {
      issuerHost = state.discovery.as.issuer;
    }
  }

  const errMessage = error ?? (state.status === "signed-out" ? state.error : undefined);

  const handleSignIn = async () => {
    try {
      setSubmitting(true);
      await login(currentReturnTo());
    } catch {
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
      </div>
    </Page>
  );
}
