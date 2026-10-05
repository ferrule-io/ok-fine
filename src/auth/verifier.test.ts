import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startDevIssuer, type DevIssuer } from "../dev/issuer.js";
import { JwtTokenVerifier, principalFromAuthInfo } from "./verifier.js";
import { createAuthenticator } from "./http-auth.js";
import { discoverAuthorizationServer } from "./discovery.js";
import { OAuthError, OAuthErrorCode } from "@modelcontextprotocol/server";

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
  });

  describe("discoverAuthorizationServer", () => {
    it("discovers metadata and jwks_uri from dev issuer", async () => {
      const discovered = await discoverAuthorizationServer(devIssuer.url);
      expect(discovered.metadata.issuer).toBe(devIssuer.url);
      expect(discovered.jwksUri).toBe(`${devIssuer.url}/jwks`);
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
      const p = principalFromAuthInfo(
        { ...baseInfo, scopes: ["okf:admin"] },
        scopeNames
      );
      expect(p.canAdmin).toBe(true);
      expect(p.canWrite).toBe(true);
      expect(p.canRead).toBe(true);
    });

    it("write grants canWrite and canRead, but not canAdmin", () => {
      const p = principalFromAuthInfo(
        { ...baseInfo, scopes: ["okf:write"] },
        scopeNames
      );
      expect(p.canAdmin).toBe(false);
      expect(p.canWrite).toBe(true);
      expect(p.canRead).toBe(true);
    });

    it("read grants canRead only", () => {
      const p = principalFromAuthInfo(
        { ...baseInfo, scopes: ["okf:read"] },
        scopeNames
      );
      expect(p.canAdmin).toBe(false);
      expect(p.canWrite).toBe(false);
      expect(p.canRead).toBe(true);
    });

    it("no recognized scopes grants none", () => {
      const p = principalFromAuthInfo(
        { ...baseInfo, scopes: ["custom:scope"] },
        scopeNames
      );
      expect(p.canAdmin).toBe(false);
      expect(p.canWrite).toBe(false);
      expect(p.canRead).toBe(false);
    });
  });
});
