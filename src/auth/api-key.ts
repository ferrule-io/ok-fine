import { createHash, timingSafeEqual } from "node:crypto";
import type { AuthInfo } from "@modelcontextprotocol/server";
import type { ApiKey } from "../config.js";
import type { Principal } from "../service/principal.js";
import { principalFromAuthInfo, type ScopeNames } from "./verifier.js";

export type IncomingHttpHeadersLike = Record<string, string | string[] | undefined>;

export interface ApiKeyAuthenticatorOptions {
  header: string;
  keys: ApiKey[];
  scopeNames: ScopeNames;
}

export type ApiKeyAuthResult =
  | { status: "none" }
  | { status: "matched"; principal: Principal; authInfo: AuthInfo; source: "header" | "bearer" }
  | { status: "invalid"; source: "header" | "bearer" };

export type ApiKeyAuthenticator = (headers: IncomingHttpHeadersLike) => ApiKeyAuthResult;

interface PrecomputedKey {
  key: ApiKey;
  digest: Buffer;
}

function getHeader(headers: IncomingHttpHeadersLike, name: string): string | string[] | undefined {
  const lower = name.toLowerCase();
  const direct = headers[lower];
  if (direct !== undefined) {
    return direct;
  }
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) {
      return headers[key];
    }
  }
  return undefined;
}

/**
 * Creates an authenticator that matches static API keys presented via either the
 * configured header (raw value) or Authorization: Bearer <key>.
 *
 * Comparisons use precomputed sha256 digests and timingSafeEqual scanning all
 * configured keys without early exit to guarantee constant-time evaluation.
 */
export function createApiKeyAuthenticator(options: ApiKeyAuthenticatorOptions): ApiKeyAuthenticator {
  const { header, keys, scopeNames } = options;
  const configuredHeaderName = header.toLowerCase();

  const precomputedKeys: PrecomputedKey[] = keys.map((key) => ({
    key,
    digest: createHash("sha256").update(key.secret).digest(),
  }));

  function findMatchingKey(candidate: string): ApiKey | null {
    const candidateDigest = createHash("sha256").update(candidate).digest();
    let matched: ApiKey | null = null;
    for (const entry of precomputedKeys) {
      if (timingSafeEqual(candidateDigest, entry.digest)) {
        matched = entry.key;
      }
    }
    return matched;
  }

  function buildPrincipalAndAuthInfo(key: ApiKey): { principal: Principal; authInfo: AuthInfo } {
    const scopes =
      key.permission === "read"
        ? [scopeNames.read]
        : key.permission === "write"
          ? [scopeNames.read, scopeNames.write]
          : [scopeNames.read, scopeNames.write, scopeNames.admin];

    const clientId = `api-key:${key.name}`;
    const authInfo: AuthInfo = {
      token: "",
      clientId,
      scopes,
      extra: {
        sub: clientId,
        identity: null,
        groups: [],
      },
    };
    const principal = principalFromAuthInfo(authInfo, scopeNames);
    return { principal, authInfo };
  }

  function authenticate(headers: IncomingHttpHeadersLike): ApiKeyAuthResult {
    const configuredValue = getHeader(headers, configuredHeaderName);
    if (configuredValue !== undefined) {
      if (Array.isArray(configuredValue)) {
        return { status: "invalid", source: "header" };
      }
      const match = findMatchingKey(configuredValue.trim());
      if (match) {
        const { principal, authInfo } = buildPrincipalAndAuthInfo(match);
        return { status: "matched", principal, authInfo, source: "header" };
      }
      return { status: "invalid", source: "header" };
    }

    const authValue = getHeader(headers, "authorization");
    if (authValue !== undefined) {
      if (Array.isArray(authValue)) {
        return { status: "invalid", source: "bearer" };
      }
      const bearerMatch = /^Bearer\s+(\S.*)$/i.exec(authValue.trim());
      if (bearerMatch) {
        const candidate = bearerMatch[1]?.trim();
        if (candidate) {
          const match = findMatchingKey(candidate);
          if (match) {
            const { principal, authInfo } = buildPrincipalAndAuthInfo(match);
            return { status: "matched", principal, authInfo, source: "bearer" };
          }
        }
        return { status: "invalid", source: "bearer" };
      }
    }

    return { status: "none" };
  }

  return authenticate;
}
