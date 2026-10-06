import { OAuthError, OAuthErrorCode } from "@modelcontextprotocol/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type DevIssuer, startDevIssuer } from "../dev/issuer.js";
import { discoverAuthorizationServer } from "./discovery.js";
import { createAuthenticator } from "./http-auth.js";
import { JwtTokenVerifier, principalFromAuthInfo } from "./verifier.js";

describe("OAuth authentication and verification", () => {
  let devIssuer: DevIssuer;
  const scopeNames = {
    read: "okf:read",
    write: "okf:write",
    admin: "okf:admin",
  };
  const audience = "http://localhost:8080/mcp";

  beforeAll(async () => {
    devIssuer = await startDevIssuer({
      audience,
    });
  });

  afterAll(async () => {
    await devIssuer.close();
  });

  describe("JwtTokenVerifier", () => {
    it("valid token → scopes and identity: 'dev'", async () => {
      const verifier = new JwtTokenVerifier({
        issuer: devIssuer.url,
        audiences: [audience],
        jwksUri: `${devIssuer.url}/jwks`,
        identityClaims: ["preferred_username", "email", "sub"],
      });

      const token = await devIssuer.mintToken({
        scope: "okf:read okf:write",
        username: "dev",
      });

      const authInfo = await verifier.verifyAccessToken(token);

      expect(authInfo.token).toBe(token);
      expect(authInfo.clientId).toBe("dev-client");
      expect(authInfo.scopes).toContain("okf:read");
      expect(authInfo.scopes).toContain("okf:write");
      expect(authInfo.extra?.identity).toBe("dev");
      expect(authInfo.extra?.sub).toBe("dev|dev");
      expect(typeof authInfo.expiresAt).toBe("number");
    });

    it("wrong aud → invalid_token", async () => {
      const verifier = new JwtTokenVerifier({
        issuer: devIssuer.url,
        audiences: ["http://expected.audience/mcp"],
        jwksUri: `${devIssuer.url}/jwks`,
        identityClaims: ["preferred_username", "email", "sub"],
      });

      const token = await devIssuer.mintToken({
        audience: "http://wrong.audience/mcp",
      });

      await expect(verifier.verifyAccessToken(token)).rejects.toThrow(OAuthError);
      await expect(verifier.verifyAccessToken(token)).rejects.toMatchObject({
        code: OAuthErrorCode.InvalidToken,
        message: "invalid aud claim",
      });
    });

    it("wrong iss → invalid_token", async () => {
      const verifier = new JwtTokenVerifier({
        issuer: "http://expected.issuer.test",
        audiences: [audience],
        jwksUri: `${devIssuer.url}/jwks`,
        identityClaims: ["preferred_username", "email", "sub"],
      });

      const token = await devIssuer.mintToken({
        issuer: "http://different.issuer.test",
      });

      await expect(verifier.verifyAccessToken(token)).rejects.toThrow(OAuthError);
      await expect(verifier.verifyAccessToken(token)).rejects.toMatchObject({
        code: OAuthErrorCode.InvalidToken,
        message: "invalid iss claim",
      });
    });

    it("expiresIn: -120 → 'token expired'", async () => {
      const verifier = new JwtTokenVerifier({
        issuer: devIssuer.url,
        audiences: [audience],
        jwksUri: `${devIssuer.url}/jwks`,
        identityClaims: ["preferred_username", "email", "sub"],
      });

      const token = await devIssuer.mintToken({
        expiresIn: -120,
      });

      await expect(verifier.verifyAccessToken(token)).rejects.toThrow(OAuthError);
      await expect(verifier.verifyAccessToken(token)).rejects.toMatchObject({
        code: OAuthErrorCode.InvalidToken,
        message: "token expired",
      });
    });

    it("claims: { scp: ['okf:write'], permissions: ['okf:admin'] } with scope: '' → scopes ['okf:write', 'okf:admin']", async () => {
      const verifier = new JwtTokenVerifier({
        issuer: devIssuer.url,
        audiences: [audience],
        jwksUri: `${devIssuer.url}/jwks`,
        identityClaims: ["preferred_username", "email", "sub"],
      });

      const token = await devIssuer.mintToken({
        scope: "",
        claims: {
          scp: ["okf:write"],
          permissions: ["okf:admin"],
        },
      });

      const authInfo = await verifier.verifyAccessToken(token);
      expect(authInfo.scopes).toHaveLength(2);
      expect(authInfo.scopes).toContain("okf:write");
      expect(authInfo.scopes).toContain("okf:admin");
    });
    describe("AccessPolicy enforcement", () => {
      it("allows token when sub matches allowedSubjects", async () => {
        const verifier = new JwtTokenVerifier({
          issuer: devIssuer.url,
          audiences: [audience],
          jwksUri: `${devIssuer.url}/jwks`,
          identityClaims: ["preferred_username", "email", "sub"],
          access: {
            allowedSubjects: ["dev|alice"],
            allowedEmails: [],
            requiredGroups: [],
            groupsClaim: "groups",
            allowedClientIds: [],
          },
        });

        const token = await devIssuer.mintToken({ username: "alice" });
        const authInfo = await verifier.verifyAccessToken(token);
        expect(authInfo.extra?.sub).toBe("dev|alice");
      });

      it("rejects token when sub does not match allowedSubjects and email is not allowed", async () => {
        const verifier = new JwtTokenVerifier({
          issuer: devIssuer.url,
          audiences: [audience],
          jwksUri: `${devIssuer.url}/jwks`,
          identityClaims: ["preferred_username", "email", "sub"],
          access: {
            allowedSubjects: ["dev|alice"],
            allowedEmails: [],
            requiredGroups: [],
            groupsClaim: "groups",
            allowedClientIds: [],
          },
        });

        const token = await devIssuer.mintToken({ username: "bob" });
        await expect(verifier.verifyAccessToken(token)).rejects.toMatchObject({
          code: OAuthErrorCode.InsufficientScope,
          message: "token not permitted by this server's access policy",
        });
      });

      it("allows token when email matches allowedEmails (case-insensitive) and email_verified is true", async () => {
        const verifier = new JwtTokenVerifier({
          issuer: devIssuer.url,
          audiences: [audience],
          jwksUri: `${devIssuer.url}/jwks`,
          identityClaims: ["preferred_username", "email", "sub"],
          access: {
            allowedSubjects: [],
            allowedEmails: ["alice@example.com"],
            requiredGroups: [],
            groupsClaim: "groups",
            allowedClientIds: [],
          },
        });

        const token = await devIssuer.mintToken({
          claims: { email: "Alice@EXAMPLE.COM", email_verified: true },
        });
        const authInfo = await verifier.verifyAccessToken(token);
        expect(authInfo.token).toBe(token);
      });

      it("rejects token when email matches allowedEmails but email_verified is false or missing", async () => {
        const verifier = new JwtTokenVerifier({
          issuer: devIssuer.url,
          audiences: [audience],
          jwksUri: `${devIssuer.url}/jwks`,
          identityClaims: ["preferred_username", "email", "sub"],
          access: {
            allowedSubjects: [],
            allowedEmails: ["alice@example.com"],
            requiredGroups: [],
            groupsClaim: "groups",
            allowedClientIds: [],
          },
        });

        const unverifiedToken = await devIssuer.mintToken({
          claims: { email: "alice@example.com", email_verified: false },
        });
        await expect(verifier.verifyAccessToken(unverifiedToken)).rejects.toMatchObject({
          code: OAuthErrorCode.InsufficientScope,
          message: "token not permitted by this server's access policy",
        });

        const missingVerifiedToken = await devIssuer.mintToken({
          claims: { email: "alice@example.com" },
        });
        await expect(verifier.verifyAccessToken(missingVerifiedToken)).rejects.toMatchObject({
          code: OAuthErrorCode.InsufficientScope,
          message: "token not permitted by this server's access policy",
        });
      });

      it("allows token when sub matches even if email does not match", async () => {
        const verifier = new JwtTokenVerifier({
          issuer: devIssuer.url,
          audiences: [audience],
          jwksUri: `${devIssuer.url}/jwks`,
          identityClaims: ["preferred_username", "email", "sub"],
          access: {
            allowedSubjects: ["dev|alice"],
            allowedEmails: ["bob@example.com"],
            requiredGroups: [],
            groupsClaim: "groups",
            allowedClientIds: [],
          },
        });

        const token = await devIssuer.mintToken({
          username: "alice",
          claims: { email: "other@example.com", email_verified: true },
        });
        const authInfo = await verifier.verifyAccessToken(token);
        expect(authInfo.extra?.sub).toBe("dev|alice");
      });

      it("allows token when verified email matches even if sub does not match", async () => {
        const verifier = new JwtTokenVerifier({
          issuer: devIssuer.url,
          audiences: [audience],
          jwksUri: `${devIssuer.url}/jwks`,
          identityClaims: ["preferred_username", "email", "sub"],
          access: {
            allowedSubjects: ["dev|alice"],
            allowedEmails: ["bob@example.com"],
            requiredGroups: [],
            groupsClaim: "groups",
            allowedClientIds: [],
          },
        });

        const token = await devIssuer.mintToken({
          username: "charlie",
          claims: { email: "bob@example.com", email_verified: true },
        });
        const authInfo = await verifier.verifyAccessToken(token);
        expect(authInfo.token).toBe(token);
      });

      it("enforces requiredGroups from array or string claims", async () => {
        const verifier = new JwtTokenVerifier({
          issuer: devIssuer.url,
          audiences: [audience],
          jwksUri: `${devIssuer.url}/jwks`,
          identityClaims: ["preferred_username", "email", "sub"],
          access: {
            allowedSubjects: [],
            allowedEmails: [],
            requiredGroups: ["admin", "editor"],
            groupsClaim: "groups",
            allowedClientIds: [],
          },
        });

        const arrayMatchToken = await devIssuer.mintToken({
          claims: { groups: ["viewer", "editor"] },
        });
        expect((await verifier.verifyAccessToken(arrayMatchToken)).token).toBe(arrayMatchToken);

        const stringMatchToken = await devIssuer.mintToken({
          claims: { groups: "admin" },
        });
        expect((await verifier.verifyAccessToken(stringMatchToken)).token).toBe(stringMatchToken);

        const noMatchToken = await devIssuer.mintToken({
          claims: { groups: ["viewer"] },
        });
        await expect(verifier.verifyAccessToken(noMatchToken)).rejects.toMatchObject({
          code: OAuthErrorCode.InsufficientScope,
          message: "token not permitted by this server's access policy",
        });

        const missingGroupsToken = await devIssuer.mintToken({});
        await expect(verifier.verifyAccessToken(missingGroupsToken)).rejects.toMatchObject({
          code: OAuthErrorCode.InsufficientScope,
          message: "token not permitted by this server's access policy",
        });
      });

      it("enforces requiredGroups using custom groupsClaim", async () => {
        const verifier = new JwtTokenVerifier({
          issuer: devIssuer.url,
          audiences: [audience],
          jwksUri: `${devIssuer.url}/jwks`,
          identityClaims: ["preferred_username", "email", "sub"],
          access: {
            allowedSubjects: [],
            allowedEmails: [],
            requiredGroups: ["admin"],
            groupsClaim: "roles",
            allowedClientIds: [],
          },
        });

        const matchToken = await devIssuer.mintToken({
          claims: { roles: ["admin", "user"] },
        });
        expect((await verifier.verifyAccessToken(matchToken)).token).toBe(matchToken);

        const noMatchToken = await devIssuer.mintToken({
          claims: { roles: ["user"] },
        });
        await expect(verifier.verifyAccessToken(noMatchToken)).rejects.toMatchObject({
          code: OAuthErrorCode.InsufficientScope,
          message: "token not permitted by this server's access policy",
        });
      });

      it("enforces allowedClientIds from azp, client_id, or cid", async () => {
        const verifier = new JwtTokenVerifier({
          issuer: devIssuer.url,
          audiences: [audience],
          jwksUri: `${devIssuer.url}/jwks`,
          identityClaims: ["preferred_username", "email", "sub"],
          access: {
            allowedSubjects: [],
            allowedEmails: [],
            requiredGroups: [],
            groupsClaim: "groups",
            allowedClientIds: ["allowed-client"],
          },
        });

        const azpToken = await devIssuer.mintToken({
          claims: { azp: "allowed-client", client_id: "other" },
        });
        expect((await verifier.verifyAccessToken(azpToken)).token).toBe(azpToken);

        const clientIdToken = await devIssuer.mintToken({
          claims: { azp: undefined, client_id: "allowed-client" },
        });
        expect((await verifier.verifyAccessToken(clientIdToken)).token).toBe(clientIdToken);

        const cidToken = await devIssuer.mintToken({
          claims: { azp: undefined, client_id: undefined, cid: "allowed-client" },
        });
        expect((await verifier.verifyAccessToken(cidToken)).token).toBe(cidToken);

        const deniedToken = await devIssuer.mintToken({
          claims: { azp: "forbidden-client", client_id: "forbidden-client" },
        });
        await expect(verifier.verifyAccessToken(deniedToken)).rejects.toMatchObject({
          code: OAuthErrorCode.InsufficientScope,
          message: "token not permitted by this server's access policy",
        });

        const noClientToken = await devIssuer.mintToken({
          claims: { azp: undefined, client_id: undefined, cid: undefined },
        });
        await expect(verifier.verifyAccessToken(noClientToken)).rejects.toMatchObject({
          code: OAuthErrorCode.InsufficientScope,
          message: "token not permitted by this server's access policy",
        });
      });
    });

    describe("email_verified identity selection", () => {
      it("uses email claim as identity when email_verified is true", async () => {
        const verifier = new JwtTokenVerifier({
          issuer: devIssuer.url,
          audiences: [audience],
          jwksUri: `${devIssuer.url}/jwks`,
          identityClaims: ["email", "preferred_username", "sub"],
        });

        const token = await devIssuer.mintToken({
          username: "alice",
          claims: { email: "alice@example.com", email_verified: true },
        });

        const authInfo = await verifier.verifyAccessToken(token);
        expect(authInfo.extra?.identity).toBe("alice@example.com");
      });

      it("falls back to next claim when email_verified is false or missing", async () => {
        const verifier = new JwtTokenVerifier({
          issuer: devIssuer.url,
          audiences: [audience],
          jwksUri: `${devIssuer.url}/jwks`,
          identityClaims: ["email", "preferred_username", "sub"],
        });

        const unverifiedToken = await devIssuer.mintToken({
          username: "alice",
          claims: { email: "alice@example.com", email_verified: false },
        });
        const unverifiedInfo = await verifier.verifyAccessToken(unverifiedToken);
        expect(unverifiedInfo.extra?.identity).toBe("alice");

        const missingVerifiedToken = await devIssuer.mintToken({
          username: "alice",
          claims: { email: "alice@example.com" },
        });
        const missingVerifiedInfo = await verifier.verifyAccessToken(missingVerifiedToken);
        expect(missingVerifiedInfo.extra?.identity).toBe("alice");
      });

      it("leaves identity as null if email_verified is false and no other claims match", async () => {
        const verifier = new JwtTokenVerifier({
          issuer: devIssuer.url,
          audiences: [audience],
          jwksUri: `${devIssuer.url}/jwks`,
          identityClaims: ["email"],
        });

        const token = await devIssuer.mintToken({
          username: "alice",
          claims: { email: "alice@example.com", email_verified: false },
        });
        const authInfo = await verifier.verifyAccessToken(token);
        expect(authInfo.extra?.identity).toBeNull();
      });

      it("unverified email and email-shaped preferred_username fall through to sub", async () => {
        const verifier = new JwtTokenVerifier({
          issuer: devIssuer.url,
          audiences: [audience],
          jwksUri: `${devIssuer.url}/jwks`,
          identityClaims: ["email", "preferred_username", "sub"],
        });

        const token = await devIssuer.mintToken({
          username: "owner",
          claims: {
            email: "owner@example.com",
            email_verified: false,
            preferred_username: "owner@example.com",
            sub: "user-12345",
          },
        });
        const authInfo = await verifier.verifyAccessToken(token);
        expect(authInfo.extra?.identity).toBe("user-12345");
      });

      it("accepts non-email-shaped preferred_username as identity", async () => {
        const verifier = new JwtTokenVerifier({
          issuer: devIssuer.url,
          audiences: [audience],
          jwksUri: `${devIssuer.url}/jwks`,
          identityClaims: ["email", "preferred_username", "sub"],
        });

        const token = await devIssuer.mintToken({
          username: "alice",
          claims: {
            preferred_username: "alice",
          },
        });
        const authInfo = await verifier.verifyAccessToken(token);
        expect(authInfo.extra?.identity).toBe("alice");
      });

      it("accepts sub containing '@' when sub is the selected claim", async () => {
        const verifier = new JwtTokenVerifier({
          issuer: devIssuer.url,
          audiences: [audience],
          jwksUri: `${devIssuer.url}/jwks`,
          identityClaims: ["email", "preferred_username", "sub"],
        });

        const token = await devIssuer.mintToken({
          username: "bob",
          claims: {
            email: "bob@example.com",
            email_verified: false,
            preferred_username: "bob@other.com",
            sub: "alice@domain.org",
          },
        });
        const authInfo = await verifier.verifyAccessToken(token);
        expect(authInfo.extra?.identity).toBe("alice@domain.org");
      });
    });
  });

  describe("discoverAuthorizationServer", () => {
    it("discovers metadata and jwks_uri from dev issuer with allowInsecureIssuer: true", async () => {
      const discovered = await discoverAuthorizationServer(devIssuer.url, { allowInsecureIssuer: true });
      expect(discovered.metadata.issuer).toBe(devIssuer.url);
      expect(discovered.jwksUri).toBe(`${devIssuer.url}/jwks`);
    });

    it("rejects http jwks_uri unless allowInsecureIssuer is true", async () => {
      await expect(discoverAuthorizationServer(devIssuer.url)).rejects.toThrow(
        `authorization server discovery failed for ${devIssuer.url}: jwks_uri must be https`,
      );
    });
  });

  describe("createAuthenticator", () => {
    it("returns a 401 Response whose WWW-Authenticate contains resource_metadata and scope='okf:read okf:write' when header is undefined", async () => {
      const verifier = new JwtTokenVerifier({
        issuer: devIssuer.url,
        audiences: [audience],
        jwksUri: `${devIssuer.url}/jwks`,
        identityClaims: ["preferred_username", "email", "sub"],
      });

      const resourceMetadataUrl = "http://localhost:8080/.well-known/oauth-protected-resource/mcp";
      const authenticator = createAuthenticator({
        verifier,
        resourceMetadataUrl,
        scopeNames,
      });

      const result = await authenticator.authenticate(undefined);
      expect(result.ok).toBe(false);
      if (result.ok) {
        expect.unreachable("expected authentication to fail");
      }
      expect(result.response.status).toBe(401);
      const wwwAuth = result.response.headers.get("www-authenticate");
      expect(wwwAuth).not.toBeNull();
      expect(wwwAuth).toContain(`resource_metadata="${resourceMetadataUrl}"`);
      expect(wwwAuth).toContain('scope="okf:read okf:write"');
    });

    it("authenticates a valid token successfully", async () => {
      const verifier = new JwtTokenVerifier({
        issuer: devIssuer.url,
        audiences: [audience],
        jwksUri: `${devIssuer.url}/jwks`,
        identityClaims: ["preferred_username", "email", "sub"],
      });

      const resourceMetadataUrl = "http://localhost:8080/.well-known/oauth-protected-resource/mcp";
      const authenticator = createAuthenticator({
        verifier,
        resourceMetadataUrl,
        scopeNames,
      });

      const token = await devIssuer.mintToken({
        scope: "okf:read",
        username: "alice",
      });

      const result = await authenticator.authenticate(`Bearer ${token}`);
      expect(result.ok).toBe(true);
      if (!result.ok) {
        expect.unreachable("expected authentication to succeed");
      }
      expect(result.principal.identity).toBe("alice");
      expect(result.principal.canRead).toBe(true);
      expect(result.principal.canWrite).toBe(false);
      expect(result.principal.canAdmin).toBe(false);
    });

    it("returns 403 when token carries no ok-fine scope", async () => {
      const verifier = new JwtTokenVerifier({
        issuer: devIssuer.url,
        audiences: [audience],
        jwksUri: `${devIssuer.url}/jwks`,
        identityClaims: ["preferred_username", "email", "sub"],
      });

      const resourceMetadataUrl = "http://localhost:8080/.well-known/oauth-protected-resource/mcp";
      const authenticator = createAuthenticator({
        verifier,
        resourceMetadataUrl,
        scopeNames,
      });

      const token = await devIssuer.mintToken({
        scope: "other:scope",
      });

      const result = await authenticator.authenticate(`Bearer ${token}`);
      expect(result.ok).toBe(false);
      if (result.ok) {
        expect.unreachable("expected authentication to fail");
      }
      expect(result.response.status).toBe(403);
      const wwwAuth = result.response.headers.get("www-authenticate");
      expect(wwwAuth).toContain('error="insufficient_scope"');
      expect(wwwAuth).toContain('scope="okf:read"');
    });

    it("insufficientScope returns 403 with named scope in challenge", () => {
      const verifier = new JwtTokenVerifier({
        issuer: devIssuer.url,
        audiences: [audience],
        jwksUri: `${devIssuer.url}/jwks`,
        identityClaims: ["preferred_username", "email", "sub"],
      });

      const resourceMetadataUrl = "http://localhost:8080/.well-known/oauth-protected-resource/mcp";
      const authenticator = createAuthenticator({
        verifier,
        resourceMetadataUrl,
        scopeNames,
      });

      const response = authenticator.insufficientScope("okf:write");
      expect(response.status).toBe(403);
      const wwwAuth = response.headers.get("www-authenticate");
      expect(wwwAuth).toContain('error="insufficient_scope"');
      expect(wwwAuth).toContain('scope="okf:write"');
      expect(wwwAuth).toContain(`resource_metadata="${resourceMetadataUrl}"`);
    });
  });

  describe("principalFromAuthInfo hierarchy", () => {
    const baseInfo = {
      token: "tok",
      clientId: "cid",
      expiresAt: 12345,
      extra: { sub: "sub1", identity: "user1" },
    };

    it("admin grants canAdmin, canWrite, canRead", () => {
      const p = principalFromAuthInfo({ ...baseInfo, scopes: ["okf:admin"] }, scopeNames);
      expect(p.canAdmin).toBe(true);
      expect(p.canWrite).toBe(true);
      expect(p.canRead).toBe(true);
    });

    it("write grants canWrite and canRead, but not canAdmin", () => {
      const p = principalFromAuthInfo({ ...baseInfo, scopes: ["okf:write"] }, scopeNames);
      expect(p.canAdmin).toBe(false);
      expect(p.canWrite).toBe(true);
      expect(p.canRead).toBe(true);
    });

    it("read grants canRead only", () => {
      const p = principalFromAuthInfo({ ...baseInfo, scopes: ["okf:read"] }, scopeNames);
      expect(p.canAdmin).toBe(false);
      expect(p.canWrite).toBe(false);
      expect(p.canRead).toBe(true);
    });

    it("no recognized scopes grants none", () => {
      const p = principalFromAuthInfo({ ...baseInfo, scopes: ["custom:scope"] }, scopeNames);
      expect(p.canAdmin).toBe(false);
      expect(p.canWrite).toBe(false);
      expect(p.canRead).toBe(false);
    });
  });
});
