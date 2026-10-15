import { useQueryClient } from "@tanstack/react-query";
import * as oauth from "oauth4webapi";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { UiClientConfig } from "../../../src/http/ui.js";
import { getUiConfig, setAuthHooks } from "../api/client.js";
import {
  type AuthDiscovery,
  buildAuthorizationUrl,
  canSignIn,
  completeAuthorization,
  discoverAuth,
  forgetClientId,
  isTokenUsable,
  type PendingLogin,
  resolveClientId,
  type StoredToken,
} from "./flow.js";
import { tokenIdentity } from "./identity.js";
import { sanitizeReturnTo } from "./returnTo.js";

export type AuthState =
  | { status: "loading" }
  | { status: "open"; config: UiClientConfig }
  | {
      status: "signed-out";
      config: UiClientConfig;
      discovery?: AuthDiscovery;
      reason: "initial" | "expired" | "signed-out";
      error?: string;
    }
  | {
      status: "unconfigured";
      config: UiClientConfig;
      discovery: AuthDiscovery;
      redirectUri: string;
    }
  | {
      status: "forbidden";
      config: UiClientConfig;
      discovery?: AuthDiscovery;
      scope: string;
    }
  | {
      status: "signed-in";
      config: UiClientConfig;
      discovery?: AuthDiscovery;
      token: StoredToken;
      identity: string | null;
    }
  | { status: "error"; message: string };

export interface AuthContextValue {
  state: AuthState;
  login(returnTo: string): Promise<void>;
  completeLogin(url: URL): Promise<string>;
  logout(): void;
  signInWithApiKey(apiKey: string): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<AuthState>({ status: "loading" });
  const stateRef = useRef(state);
  stateRef.current = state;

  const inFlightLoginsRef = useRef<Map<string, Promise<string>>>(new Map());

  useEffect(() => {
    let active = true;

    const boot = async () => {
      try {
        const config = await getUiConfig();
        if (!active) return;

        if (config.authMode === "none") {
          setState({ status: "open", config });
          return;
        }

        if (config.authMode === "api_key") {
          const storedKey = window.sessionStorage.getItem("okf.apiKey");
          if (storedKey) {
            try {
              const res = await fetch("/api/v1/projects", {
                headers: { authorization: `Bearer ${storedKey}` },
              });
              if (!active) return;
              if (res.ok) {
                setState({
                  status: "signed-in",
                  config,
                  token: { accessToken: storedKey, expiresAt: null },
                  identity: null,
                });
                return;
              }
              window.sessionStorage.removeItem("okf.apiKey");
            } catch {
              window.sessionStorage.removeItem("okf.apiKey");
            }
          }

          if (!active) return;
          setState({
            status: "signed-out",
            config,
            reason: "initial",
          });
          return;
        }
        const discovery = await discoverAuth(window.location.origin);
        if (!active) return;

        if (!canSignIn(discovery, config)) {
          setState({
            status: "unconfigured",
            config,
            discovery,
            redirectUri: `${window.location.origin}/ui/callback`,
          });
          return;
        }

        const tokenJson = window.sessionStorage.getItem("okf.oauth.token");
        if (tokenJson) {
          try {
            const parsed: unknown = JSON.parse(tokenJson);
            if (
              typeof parsed === "object" &&
              parsed !== null &&
              "accessToken" in parsed &&
              typeof parsed.accessToken === "string"
            ) {
              const expiresAtVal =
                "expiresAt" in parsed && typeof parsed.expiresAt === "number" ? parsed.expiresAt : null;
              const token: StoredToken = {
                accessToken: parsed.accessToken,
                expiresAt: expiresAtVal,
              };
              if (isTokenUsable(token)) {
                const identity = tokenIdentity(token.accessToken);
                setState({
                  status: "signed-in",
                  config,
                  discovery,
                  token,
                  identity,
                });
                return;
              }
            }
          } catch {
            // Bad token JSON in storage, ignore and sign out
          }
          window.sessionStorage.removeItem("okf.oauth.token");
          window.sessionStorage.removeItem("okf.oauth.pending");
        }

        setState({
          status: "signed-out",
          config,
          discovery,
          reason: "initial",
        });
      } catch (err) {
        if (!active) return;
        const message = err instanceof Error ? err.message : "Failed to initialize authentication";
        setState({ status: "error", message });
      }
    };

    boot();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setAuthHooks({
      getToken: () => {
        const current = stateRef.current;
        if (current.status === "signed-in" && isTokenUsable(current.token)) {
          return current.token.accessToken;
        }
        return null;
      },
      authMode: () => {
        const current = stateRef.current;
        return "config" in current ? current.config.authMode : null;
      },
      onUnauthorized: () => {
        window.sessionStorage.removeItem("okf.oauth.token");
        window.sessionStorage.removeItem("okf.oauth.pending");
        window.sessionStorage.removeItem("okf.apiKey");
        queryClient.clear();
        const current = stateRef.current;
        if ("config" in current) {
          setState({
            status: "signed-out",
            config: current.config,
            discovery: "discovery" in current ? current.discovery : undefined,
            reason: "expired",
          });
        }
      },
      onForbidden: () => {
        const current = stateRef.current;
        if ("config" in current) {
          setState({
            status: "forbidden",
            config: current.config,
            discovery: "discovery" in current ? current.discovery : undefined,
            scope: current.config.scope,
          });
        }
      },
    });
  }, [queryClient]);

  useEffect(() => {
    if (state.status !== "signed-in" || state.token.expiresAt === null) {
      return;
    }

    const msUntilExpiry = state.token.expiresAt - 30_000 - Date.now();
    if (msUntilExpiry <= 0) {
      window.sessionStorage.removeItem("okf.oauth.token");
      window.sessionStorage.removeItem("okf.oauth.pending");
      queryClient.clear();
      setState({
        status: "signed-out",
        config: state.config,
        discovery: state.discovery,
        reason: "expired",
      });
      return;
    }

    const timer = setTimeout(() => {
      window.sessionStorage.removeItem("okf.oauth.token");
      window.sessionStorage.removeItem("okf.oauth.pending");
      queryClient.clear();
      setState({
        status: "signed-out",
        config: state.config,
        discovery: state.discovery,
        reason: "expired",
      });
    }, msUntilExpiry);

    return () => {
      clearTimeout(timer);
    };
  }, [state, queryClient]);

  const login = useCallback(async (returnTo: string) => {
    let config: UiClientConfig;
    let discovery: AuthDiscovery;
    const current = stateRef.current;
    if ("config" in current && "discovery" in current && current.discovery) {
      config = current.config;
      discovery = current.discovery;
    } else {
      config = await getUiConfig();
      if (config.authMode !== "oidc") {
        return;
      }
      discovery = await discoverAuth(window.location.origin);
    }
    const redirectUri = `${window.location.origin}/ui/callback`;
    const clientId = await resolveClientId(discovery, config, redirectUri, window.localStorage);
    const safeReturnTo = sanitizeReturnTo(returnTo, window.location.origin);
    const { url, pending } = await buildAuthorizationUrl(discovery, clientId, redirectUri, config.scope, safeReturnTo);
    window.sessionStorage.setItem("okf.oauth.pending", JSON.stringify(pending));
    window.location.assign(url.href);
  }, []);

  const completeLogin = useCallback(async (url: URL): Promise<string> => {
    const cachedPromise = inFlightLoginsRef.current.get(url.href);
    if (cachedPromise) {
      return cachedPromise;
    }

    const execute = async (): Promise<string> => {
      let config: UiClientConfig;
      let discovery: AuthDiscovery;
      const current = stateRef.current;
      if ("config" in current && "discovery" in current && current.discovery) {
        config = current.config;
        discovery = current.discovery;
      } else {
        config = await getUiConfig();
        discovery = await discoverAuth(window.location.origin);
      }

      const pendingRaw = window.sessionStorage.getItem("okf.oauth.pending");
      window.sessionStorage.removeItem("okf.oauth.pending");
      if (!pendingRaw) {
        throw new Error("Sign-in session expired; try again");
      }

      let pending: PendingLogin;
      try {
        const parsed: unknown = JSON.parse(pendingRaw);
        if (
          typeof parsed !== "object" ||
          parsed === null ||
          !("state" in parsed) ||
          !("codeVerifier" in parsed) ||
          !("clientId" in parsed) ||
          !("redirectUri" in parsed) ||
          !("returnTo" in parsed) ||
          typeof parsed.state !== "string" ||
          typeof parsed.codeVerifier !== "string" ||
          typeof parsed.clientId !== "string" ||
          typeof parsed.redirectUri !== "string" ||
          typeof parsed.returnTo !== "string"
        ) {
          throw new Error("Invalid pending login session");
        }
        pending = {
          state: parsed.state,
          codeVerifier: parsed.codeVerifier,
          clientId: parsed.clientId,
          redirectUri: parsed.redirectUri,
          returnTo: parsed.returnTo,
        };
      } catch (err) {
        throw new Error("Sign-in session expired; try again", { cause: err });
      }

      try {
        const token = await completeAuthorization(discovery, pending, url);
        window.sessionStorage.setItem("okf.oauth.token", JSON.stringify(token));
        const identity = tokenIdentity(token.accessToken);
        setState({
          status: "signed-in",
          config,
          discovery,
          token,
          identity,
        });
        return sanitizeReturnTo(pending.returnTo, window.location.origin);
      } catch (err) {
        if (err instanceof oauth.AuthorizationResponseError || err instanceof oauth.ResponseBodyError) {
          if (err.error === "invalid_client" || err.error === "unauthorized_client") {
            forgetClientId(discovery, pending.redirectUri, window.localStorage);
          }
          const errMsg = err.error_description ? `${err.error}: ${err.error_description}` : err.error;
          setState({
            status: "signed-out",
            config,
            discovery,
            reason: "signed-out",
            error: errMsg,
          });
        }
        throw err;
      }
    };

    const promise = execute();
    inFlightLoginsRef.current.set(url.href, promise);
    return promise;
  }, []);

  const logout = useCallback(() => {
    window.sessionStorage.removeItem("okf.oauth.token");
    window.sessionStorage.removeItem("okf.oauth.pending");
    window.sessionStorage.removeItem("okf.apiKey");
    queryClient.clear();
    const current = stateRef.current;
    if ("config" in current) {
      setState({
        status: "signed-out",
        config: current.config,
        discovery: "discovery" in current ? current.discovery : undefined,
        reason: "signed-out",
      });
    }
  }, [queryClient]);

  const signInWithApiKey = useCallback(async (apiKey: string) => {
    const trimmed = apiKey.trim();
    if (!trimmed) {
      throw new Error("API key is required");
    }

    const res = await fetch("/api/v1/projects", {
      headers: {
        authorization: `Bearer ${trimmed}`,
      },
    });

    if (!res.ok) {
      window.sessionStorage.removeItem("okf.apiKey");
      if (res.status === 401) {
        let msg = "Invalid API key";
        try {
          const body = (await res.json()) as { error?: { message?: string } };
          if (body?.error?.message) {
            msg = body.error.message;
          }
        } catch {}
        throw new Error(msg);
      }
      let message = `Authentication failed (HTTP ${res.status})`;
      try {
        const body = (await res.json()) as { error?: { message?: string } };
        if (body?.error?.message) {
          message = body.error.message;
        }
      } catch {}
      throw new Error(message);
    }

    window.sessionStorage.setItem("okf.apiKey", trimmed);
    const current = stateRef.current;
    let config: UiClientConfig;
    if ("config" in current) {
      config = current.config;
    } else {
      config = await getUiConfig();
    }

    setState({
      status: "signed-in",
      config,
      token: {
        accessToken: trimmed,
        expiresAt: null,
      },
      identity: null,
    });
  }, []);

  const value: AuthContextValue = {
    state,
    login,
    completeLogin,
    logout,
    signInWithApiKey,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
