import {
  OAuthError,
  OAuthErrorCode,
  bearerAuthChallengeResponse,
  verifyBearerToken,
  type AuthInfo,
  type OAuthTokenVerifier,
} from "@modelcontextprotocol/server";
import { principalFromAuthInfo, type ScopeNames } from "./verifier.js";
import type { Principal } from "../service/principal.js";

export interface AuthenticatorOptions {
  verifier: OAuthTokenVerifier;
  resourceMetadataUrl: string;
  scopeNames: ScopeNames;
}

export interface AuthenticateSuccess {
  ok: true;
  authInfo: AuthInfo;
  principal: Principal;
}

export interface AuthenticateFailure {
  ok: false;
  response: Response;
}

export type AuthenticateResult = AuthenticateSuccess | AuthenticateFailure;

export interface Authenticator {
  authenticate(authorizationHeader: string | null | undefined): Promise<AuthenticateResult>;
  insufficientScope(scopeName: string): Response;
}

function makeChallengeResponse(
  error: unknown,
  requiredScopes: string[],
  resourceMetadataUrl: string
): Response {
  const response = bearerAuthChallengeResponse(error, {
    requiredScopes,
    resourceMetadataUrl,
  });

  const authHeader = response.headers.get("www-authenticate");
  if (authHeader && !authHeader.includes("scope=")) {
    const scopeVal = requiredScopes.join(" ");
    const updatedHeaders = new Headers(response.headers);
    updatedHeaders.set("www-authenticate", `${authHeader}, scope="${scopeVal}"`);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: updatedHeaders,
    });
  }

  return response;
}

/**
 * Creates an authenticator for HTTP requests that validates Bearer tokens
 * against the verifier and produces standard RFC 9728 / RFC 6750 challenge responses.
 */
export function createAuthenticator(options: AuthenticatorOptions): Authenticator {
  const { verifier, resourceMetadataUrl, scopeNames } = options;

  async function authenticate(
    authorizationHeader: string | null | undefined
  ): Promise<AuthenticateResult> {
    try {
      const authInfo = await verifyBearerToken(authorizationHeader, {
        verifier,
        resourceMetadataUrl,
      });

      const principal = principalFromAuthInfo(authInfo, scopeNames);

      if (!principal.canRead) {
        const response = makeChallengeResponse(
          new OAuthError(OAuthErrorCode.InsufficientScope, "token carries no ok-fine scope"),
          [scopeNames.read],
          resourceMetadataUrl
        );
        return { ok: false, response };
      }

      return { ok: true, authInfo, principal };
    } catch (err: unknown) {
      const response = makeChallengeResponse(
        err,
        [scopeNames.read, scopeNames.write],
        resourceMetadataUrl
      );
      return { ok: false, response };
    }
  }

  function insufficientScope(scopeName: string): Response {
    return makeChallengeResponse(
      new OAuthError(OAuthErrorCode.InsufficientScope, `requires ${scopeName}`),
      [scopeName],
      resourceMetadataUrl
    );
  }

  return { authenticate, insufficientScope };
}
