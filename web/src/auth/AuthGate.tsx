import { motion } from "motion/react";
import { Outlet } from "react-router";
import { ErrorState } from "../components/ErrorState.js";
import { Logo } from "../components/Logo.js";
import { ForbiddenPage } from "../pages/ForbiddenPage.js";
import { NotConfiguredPage } from "../pages/NotConfiguredPage.js";
import { SignInPage } from "../pages/SignInPage.js";
import { useAuth } from "./AuthProvider.js";

export function AuthGate() {
  const { state } = useAuth();

  if (state.status === "loading") {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-bg">
        <motion.div
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{
            duration: 1.2,
            repeat: Number.POSITIVE_INFINITY,
            ease: "easeInOut",
          }}
        >
          <Logo size={48} />
        </motion.div>
      </div>
    );
  }

  if (state.status === "open" || state.status === "signed-in") {
    return <Outlet />;
  }

  if (state.status === "signed-out") {
    return <SignInPage error={state.error} />;
  }

  if (state.status === "unconfigured") {
    return <NotConfiguredPage />;
  }

  if (state.status === "forbidden") {
    return <ForbiddenPage />;
  }

  if (state.status === "error") {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-bg p-6">
        <ErrorState error={state.message} onRetry={() => window.location.reload()} fullScreen />
      </div>
    );
  }

  return null;
}
