import { type AuthInfo, OAuthError, OAuthErrorCode, type OAuthTokenVerifier } from "@modelcontextprotocol/server";
import { createRemoteJWKSet, errors, type JWTVerifyGetKey, type JWTVerifyResult, jwtVerify } from "jose";
import type { AccessPolicy } from "../config.js";
import type { Principal } from "../service/principal.js";

export interface JwtTokenVerifierOptions {
  issuer: string;
  audiences: string[];
  jwksUri: string;
  identityClaims: string[];
  access?: AccessPolicy;
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
  private readonly access?: AccessPolicy;

  constructor(options: JwtTokenVerifierOptions) {
    this.issuer = options.issuer;
    this.audiences = options.audiences;
    this.identityClaims = options.identityClaims;
    this.access = options.access;
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

    if (this.access) {
      const { allowedSubjects, allowedEmails, requiredGroups, groupsClaim, allowedClientIds } = this.access;

      if (allowedSubjects.length > 0 || allowedEmails.length > 0) {
        const sub = typeof payload.sub === "string" ? payload.sub : undefined;
        const subMatch = sub !== undefined && allowedSubjects.includes(sub);

        const email = typeof payload.email === "string" ? payload.email.toLowerCase() : undefined;
        const emailVerified = payload.email_verified === true;
        const emailMatch = emailVerified && email !== undefined && allowedEmails.includes(email);

        if (!subMatch && !emailMatch) {
          throw new OAuthError(OAuthErrorCode.InsufficientScope, "token not permitted by this server's access policy");
        }
      }

      if (requiredGroups.length > 0) {
        const tokenGroups = readGroups(payload[groupsClaim]);
        const hasRequiredGroup = tokenGroups.some((g) => requiredGroups.includes(g));
        if (!hasRequiredGroup) {
          throw new OAuthError(OAuthErrorCode.InsufficientScope, "token not permitted by this server's access policy");
        }
      }

      if (allowedClientIds.length > 0) {
        const clientIds = [payload.azp, payload.client_id, payload.cid].filter(
          (v): v is string => typeof v === "string" && v.length > 0,
        );
        const clientAllowed = clientIds.some((id) => allowedClientIds.includes(id));
        if (!clientAllowed) {
          throw new OAuthError(OAuthErrorCode.InsufficientScope, "token not permitted by this server's access policy");
        }
      }
    }

    let identity: string | null = null;
    for (const claim of this.identityClaims) {
      if (claim === "email" && payload.email_verified !== true) {
        continue;
      }
      const val = payload[claim];
      if (typeof val === "string" && val.trim().length > 0) {
        const trimmed = val.trim();
        if (claim !== "email" && claim !== "sub" && trimmed.includes("@")) {
          continue;
        }
        identity = trimmed;
        break;
      }
    }

    const groups = readGroups(payload[this.access?.groupsClaim ?? "groups"]);

    return {
      token,
      clientId,
      scopes,
      expiresAt: payload.exp,
      extra: {
        sub: typeof payload.sub === "string" ? payload.sub : "unknown",
        identity,
        groups,
      },
    };
  }
}

/** Normalizes a groups claim, accepted as a string or an array of strings. */
function readGroups(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((g): g is string => typeof g === "string");
  return [];
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
  const extraGroups = info.extra?.groups;

  const sub = typeof extraSub === "string" ? extraSub : "unknown";
  const identity = typeof extraIdentity === "string" ? extraIdentity : null;
  const groups = Array.isArray(extraGroups) ? extraGroups.filter((g): g is string => typeof g === "string") : [];

  return {
    subject: sub,
    clientId: info.clientId,
    identity,
    groups,
    scopes: info.scopes,
    canRead,
    canWrite,
    canAdmin,
  };
}
