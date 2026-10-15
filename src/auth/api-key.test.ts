import { describe, expect, it } from "vitest";
import type { ApiKey } from "../config.js";
import { OkfError } from "../errors.js";
import { checkActor } from "../service/principal.js";
import { createApiKeyAuthenticator } from "./api-key.js";
import type { ScopeNames } from "./verifier.js";

const scopeNames: ScopeNames = {
  read: "okf:read",
  write: "okf:write",
  admin: "okf:admin",
};

const readKey: ApiKey = {
  name: "reader",
  permission: "read",
  secret: "0123456789abcdef0123456789abcdef",
};

const writeKey: ApiKey = {
  name: "writer",
  permission: "write",
  secret: "1123456789abcdef0123456789abcdef",
};

const adminKey: ApiKey = {
  name: "admin",
  permission: "admin",
  secret: "2123456789abcdef0123456789abcdef",
};

describe("createApiKeyAuthenticator", () => {
  const authenticator = createApiKeyAuthenticator({
    header: "x-api-key",
    keys: [readKey, writeKey, adminKey],
    scopeNames,
  });

  describe("header match per permission", () => {
    it("read key matches and grants exact read permissions", () => {
      const result = authenticator({ "x-api-key": readKey.secret });
      expect(result.status).toBe("matched");
      if (result.status !== "matched") return;

      expect(result.source).toBe("header");
      expect(result.authInfo.clientId).toBe("api-key:reader");
      expect(result.authInfo.token).toBe("");
      expect(result.authInfo.scopes).toEqual(["okf:read"]);
      expect(result.authInfo.extra?.sub).toBe("api-key:reader");
      expect(result.authInfo.extra?.identity).toBeNull();

      expect(result.principal.subject).toBe("api-key:reader");
      expect(result.principal.clientId).toBe("api-key:reader");
      expect(result.principal.identity).toBeNull();
      expect(result.principal.groups).toEqual([]);
      expect(result.principal.scopes).toEqual(["okf:read"]);
      expect(result.principal.canRead).toBe(true);
      expect(result.principal.canWrite).toBe(false);
      expect(result.principal.canAdmin).toBe(false);

      expect(() => checkActor("human:alice@example.com", result.principal)).toThrow(OkfError);
      expect(checkActor("agent/1.0", result.principal)).toBe("agent/1.0");
    });

    it("write key matches and grants read and write permissions", () => {
      const result = authenticator({ "x-api-key": writeKey.secret });
      expect(result.status).toBe("matched");
      if (result.status !== "matched") return;

      expect(result.source).toBe("header");
      expect(result.authInfo.clientId).toBe("api-key:writer");
      expect(result.authInfo.scopes).toEqual(["okf:read", "okf:write"]);
      expect(result.principal.canRead).toBe(true);
      expect(result.principal.canWrite).toBe(true);
      expect(result.principal.canAdmin).toBe(false);
    });

    it("admin key matches and grants read, write, and admin permissions", () => {
      const result = authenticator({ "x-api-key": adminKey.secret });
      expect(result.status).toBe("matched");
      if (result.status !== "matched") return;

      expect(result.source).toBe("header");
      expect(result.authInfo.clientId).toBe("api-key:admin");
      expect(result.authInfo.scopes).toEqual(["okf:read", "okf:write", "okf:admin"]);
      expect(result.principal.canRead).toBe(true);
      expect(result.principal.canWrite).toBe(true);
      expect(result.principal.canAdmin).toBe(true);
    });
  });

  describe("bearer match", () => {
    it("matches key presented via Authorization: Bearer", () => {
      const result = authenticator({ authorization: `Bearer ${adminKey.secret}` });
      expect(result.status).toBe("matched");
      if (result.status !== "matched") return;

      expect(result.source).toBe("bearer");
      expect(result.principal.clientId).toBe("api-key:admin");
      expect(result.principal.canAdmin).toBe(true);
    });

    it("matches key case-insensitively on bearer prefix and ignores surrounding whitespace", () => {
      const result = authenticator({ authorization: `bearer   ${writeKey.secret}  ` });
      expect(result.status).toBe("matched");
      if (result.status !== "matched") return;

      expect(result.source).toBe("bearer");
      expect(result.principal.clientId).toBe("api-key:writer");
      expect(result.principal.canWrite).toBe(true);
    });
  });

  describe("wrong key invalid", () => {
    it("returns invalid with header source for mismatched configured header", () => {
      const result = authenticator({ "x-api-key": "invalid-secret-that-does-not-match-anything" });
      expect(result).toEqual({ status: "invalid", source: "header" });
    });

    it("returns invalid with bearer source for mismatched bearer token", () => {
      const result = authenticator({ authorization: "Bearer invalid-secret-that-does-not-match-anything" });
      expect(result).toEqual({ status: "invalid", source: "bearer" });
    });
  });

  describe("absent -> none", () => {
    it("returns none when no credentials are provided", () => {
      const result = authenticator({});
      expect(result).toEqual({ status: "none" });
    });

    it("returns none when non-bearer authorization is provided", () => {
      const result = authenticator({ authorization: "Basic dXNlcjpwYXNz" });
      expect(result).toEqual({ status: "none" });
    });
  });

  describe("array header invalid", () => {
    it("returns invalid with header source when configured header is an array", () => {
      const result = authenticator({ "x-api-key": [readKey.secret, writeKey.secret] });
      expect(result).toEqual({ status: "invalid", source: "header" });
    });

    it("returns invalid with bearer source when authorization header is an array", () => {
      const result = authenticator({ authorization: [`Bearer ${readKey.secret}`, `Bearer ${writeKey.secret}`] });
      expect(result).toEqual({ status: "invalid", source: "bearer" });
    });
  });

  describe("custom header name", () => {
    it("recognizes configured custom header name case-insensitively", () => {
      const customAuth = createApiKeyAuthenticator({
        header: "X-Custom-Auth-Key",
        keys: [adminKey],
        scopeNames,
      });

      const matchedLower = customAuth({ "x-custom-auth-key": adminKey.secret });
      expect(matchedLower.status).toBe("matched");
      if (matchedLower.status === "matched") {
        expect(matchedLower.source).toBe("header");
      }

      const matchedUpper = customAuth({ "X-CUSTOM-AUTH-KEY": adminKey.secret });
      expect(matchedUpper.status).toBe("matched");
      if (matchedUpper.status === "matched") {
        expect(matchedUpper.source).toBe("header");
      }
    });
  });
});
