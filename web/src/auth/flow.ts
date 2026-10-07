import * as oauth from "oauth4webapi";
import type { UiClientConfig } from "../../../src/http/ui.js";

export interface KeyValueStore {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

export interface AuthDiscovery {
  as: oauth.AuthorizationServer;
  resource: string;
  insecure: boolean;
}

export interface PendingLogin {
  state: string;
  codeVerifier: string;
  clientId: string;
  redirectUri: string;
  returnTo: string;
}

export interface StoredToken {
  accessToken: string;
  expiresAt: number | null;
}

function parseProtectedResourceMetadata(raw: unknown): { resource: string; primaryServer: string } {
  if (
    typeof raw !== "object" ||
    raw === null ||
    !("resource" in raw) ||
    typeof raw.resource !== "string" ||
    !("authorization_servers" in raw) ||
    !Array.isArray(raw.authorization_servers) ||
    raw.authorization_servers.length === 0
  ) {
    throw new Error("invalid protected resource metadata");
  }
  const primaryServer = raw.authorization_servers[0];
  if (typeof primaryServer !== "string") {
    throw new Error("invalid protected resource metadata");
  }
  return { resource: raw.resource, primaryServer };
}

export async function discoverAuth(origin: string): Promise<AuthDiscovery> {
  const prmUrl = `${origin.replace(/\/+$/, "")}/.well-known/oauth-protected-resource/mcp`;
  const prmRes = await fetch(prmUrl);
  if (!prmRes.ok) {
    throw new Error("invalid protected resource metadata");
  }
  let prm: unknown;
  try {
    prm = await prmRes.json();
  } catch {
    throw new Error("invalid protected resource metadata");
  }

  const { resource, primaryServer } = parseProtectedResourceMetadata(prm);

  const asUrl = `${origin.replace(/\/+$/, "")}/.well-known/oauth-authorization-server`;
  const asRes = await fetch(asUrl);
  const as = await oauth.processDiscoveryResponse(new URL(primaryServer), asRes);

  const insecure = new URL(as.token_endpoint ?? as.issuer).protocol === "http:";

  return { as, resource, insecure };
}

export function canSignIn(d: AuthDiscovery, config: UiClientConfig): boolean {
  return config.oauthClientId !== null || typeof d.as.registration_endpoint === "string";
}

export async function resolveClientId(
  d: AuthDiscovery,
  config: UiClientConfig,
  redirectUri: string,
  store: KeyValueStore,
): Promise<string> {
  if (config.oauthClientId) {
    return config.oauthClientId;
  }
  const key = `okf.oauth.client:${d.as.issuer}:${redirectUri}`;
  const cached = store.getItem(key);
  if (cached && typeof cached === "string" && cached.trim().length > 0) {
    return cached.trim();
  }
  if (typeof d.as.registration_endpoint !== "string") {
    throw new Error("sign-in is not configured");
  }
  const res = await oauth.dynamicClientRegistrationRequest(
    d.as,
    {
      client_name: "ok-fine web",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: config.scope,
    },
    { [oauth.allowInsecureRequests]: d.insecure },
  );
  const client = await oauth.processDynamicClientRegistrationResponse(res);
  store.setItem(key, client.client_id);
  return client.client_id;
}

export function forgetClientId(d: AuthDiscovery, redirectUri: string, store: KeyValueStore): void {
  const key = `okf.oauth.client:${d.as.issuer}:${redirectUri}`;
  store.removeItem(key);
}

export async function buildAuthorizationUrl(
  d: AuthDiscovery,
  clientId: string,
  redirectUri: string,
  scope: string,
  returnTo: string,
): Promise<{ url: URL; pending: PendingLogin }> {
  const codeVerifier = oauth.generateRandomCodeVerifier();
  const codeChallenge = await oauth.calculatePKCECodeChallenge(codeVerifier);
  const state = oauth.generateRandomState();

  if (!d.as.authorization_endpoint) {
    throw new Error("missing authorization endpoint in authorization server metadata");
  }

  const url = new URL(d.as.authorization_endpoint);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", scope);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  url.searchParams.set("resource", d.resource);

  const pending: PendingLogin = {
    state,
    codeVerifier,
    clientId,
    redirectUri,
    returnTo,
  };

  return { url, pending };
}

export async function completeAuthorization(
  d: AuthDiscovery,
  pending: PendingLogin,
  callbackUrl: URL,
): Promise<StoredToken> {
  const client: oauth.Client = { client_id: pending.clientId };
  const params = oauth.validateAuthResponse(d.as, client, callbackUrl, pending.state);
  const response = await oauth.authorizationCodeGrantRequest(
    d.as,
    client,
    oauth.None(),
    params,
    pending.redirectUri,
    pending.codeVerifier,
    {
      additionalParameters: { resource: d.resource },
      [oauth.allowInsecureRequests]: d.insecure,
    },
  );
  const result = await oauth.processAuthorizationCodeResponse(d.as, client, response);
  return {
    accessToken: result.access_token,
    expiresAt: result.expires_in ? Date.now() + result.expires_in * 1000 : null,
  };
}

export function isTokenUsable(t: StoredToken, now = Date.now()): boolean {
  return t.accessToken.length > 0 && (t.expiresAt === null || t.expiresAt - 30_000 > now);
}
