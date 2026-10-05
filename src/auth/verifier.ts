import {
  OAuthError,
  OAuthErrorCode,
  type OAuthTokenVerifier,
  type AuthInfo,
} from "@modelcontextprotocol/server";
import { createRemoteJWKSet, jwtVerify, errors, type JWTVerifyGetKey, type JWTVerifyResult } from "jose";
import type { Principal } from "../service/principal.js";

export interface JwtTokenVerifierOptions {
  issuer: string;
  audiences: string[];
  jwksUri: string;
  identityClaims: string[];
}

export interface ScopeNames {
  read: string;
  write: string;
  admin: string;
}

/**
 * Validates JWT access tokens against a remote JWKS.
 */
export class JwtTokenVerifier implements OAuthTokenVerifier {
  private readonly issuer: string;
  private readonly audiences: string[];
  private readonly identityClaims: string[];
  private readonly jwks: JWTVerifyGetKey;

  constructor(options: JwtTokenVerifierOptions) {
    this.issuer = options.issuer;
    this.audiences = options.audiences;
    this.identityClaims = options.identityClaims;
    this.jwks = createRemoteJWKSet(new URL(options.jwksUri), {
      cooldownDuration: 30000,
      cacheMaxAge: 600000,
      timeoutDuration: 5000,
    });
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    let result: JWTVerifyResult;
    try {
      result = await jwtVerify(token, this.jwks, {
        issuer: this.issuer,
        audience: this.audiences,
        clockTolerance: 30,
      });
    } catch (err: unknown) {
      if (err instanceof errors.JWTExpired) {
        throw new OAuthError(OAuthErrorCode.InvalidToken, "token expired");
      }
      if (err instanceof errors.JWTClaimValidationFailed) {
        const claim = err.claim || "claim";
        throw new OAuthError(OAuthErrorCode.InvalidToken, `invalid ${claim} claim`);
      }
      if (err instanceof errors.JWKSTimeout) {
        throw new OAuthError(OAuthErrorCode.ServerError, "JWKS fetch timed out");
      }
      throw new OAuthError(OAuthErrorCode.InvalidToken, "invalid token");
    }

    const payload = result.payload;
    if (typeof payload.exp !== "number") {
      throw new OAuthError(OAuthErrorCode.InvalidToken, "token has no exp");
    }

    const scopeSet = new Set<string>();

    if (typeof payload.scope === "string") {
      for (const s of payload.scope.trim().split(/\s+/)) {
        if (s.length > 0) {
          scopeSet.add(s);
        }
      }
    }

    if (typeof payload.scp === "string") {
      for (const s of payload.scp.trim().split(/\s+/)) {
        if (s.length > 0) {
          scopeSet.add(s);
        }
      }
    } else if (Array.isArray(payload.scp)) {
      for (const s of payload.scp) {
        if (typeof s === "string" && s.trim().length > 0) {
          scopeSet.add(s.trim());
        }
      }
    }

    if (Array.isArray(payload.permissions)) {
      for (const p of payload.permissions) {
        if (typeof p === "string" && p.trim().length > 0) {
          scopeSet.add(p.trim());
        }
      }
    }

    const scopes = Array.from(scopeSet);

    let clientId = "unknown";
    for (const field of ["azp", "client_id", "cid"] as const) {
      const val = payload[field];
      if (typeof val === "string" && val.length > 0) {
        clientId = val;
        break;
      }
    }

    let identity: string | null = null;
    for (const claim of this.identityClaims) {
      const val = payload[claim];
      if (typeof val === "string" && val.trim().length > 0) {
        identity = val.trim();
        break;
      }
    }

    return {
      token,
      clientId,
      scopes,
      expiresAt: payload.exp,
      extra: {
        sub: typeof payload.sub === "string" ? payload.sub : "unknown",
        identity,
      },
    };
  }
}

/**
 * Computes a Principal from an AuthInfo and configured scope names.
 * Hierarchy:
 * - canAdmin = has admin scope
 * - canWrite = write or admin
 * - canRead = read, write, or admin
 */
export function principalFromAuthInfo(info: AuthInfo, scopeNames: ScopeNames): Principal {
  const hasAdmin = info.scopes.includes(scopeNames.admin);
  const hasWrite = info.scopes.includes(scopeNames.write);
  const hasRead = info.scopes.includes(scopeNames.read);

  const canAdmin = hasAdmin;
  const canWrite = hasWrite || hasAdmin;
  const canRead = hasRead || hasWrite || hasAdmin;

  const extraSub = info.extra?.sub;
  const extraIdentity = info.extra?.identity;

  const sub = typeof extraSub === "string" ? extraSub : "unknown";
  const identity = typeof extraIdentity === "string" ? extraIdentity : null;

  return {
    subject: sub,
    clientId: info.clientId,
    identity,
    scopes: info.scopes,
    canRead,
    canWrite,
    canAdmin,
  };
}
