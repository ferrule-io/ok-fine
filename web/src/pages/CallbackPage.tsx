import { LoaderCircle } from "lucide-react";
import * as oauth from "oauth4webapi";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "../auth/AuthProvider.js";
import { sanitizeReturnTo } from "../auth/returnTo.js";
import { Page } from "../components/Page.js";
import { SignInPage } from "./SignInPage.js";

export function CallbackPage() {
  const { completeLogin } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    const url = new URL(window.location.href);
    completeLogin(url)
      .then((returnTo) => {
        navigate(sanitizeReturnTo(returnTo), { replace: true });
      })
      .catch((err) => {
        let msg: string;
        if (err instanceof oauth.AuthorizationResponseError || err instanceof oauth.ResponseBodyError) {
          msg = err.error_description ? `${err.error}: ${err.error_description}` : err.error;
        } else {
          msg = err instanceof Error ? err.message : String(err);
        }
        setError(msg);
      });
  }, [completeLogin, navigate]);

  if (error !== null) {
    return <SignInPage error={error} />;
  }

  return (
    <Page title="Signing in" className="min-h-screen flex items-center justify-center p-6 bg-bg">
      <div className="flex flex-col items-center justify-center gap-3">
        <LoaderCircle size={36} className="animate-spin text-accent-500" />
        <p className="text-sm font-medium text-muted">Signing you in…</p>
      </div>
    </Page>
  );
}
