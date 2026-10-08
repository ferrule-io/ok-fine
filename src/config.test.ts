import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const required = { PUBLIC_BASE_URL: "https://okf.example.com/", OAUTH_ISSUER: "https://idp.example.com" };

describe("loadConfig", () => {
  it("applies defaults and derives the audience from the public base URL", () => {
    const config = loadConfig(required);
    expect(config.port).toBe(8080);
    expect(config.publicBaseUrl).toBe("https://okf.example.com");
    expect(config.auth).toEqual({
      mode: "oidc",
      issuer: "https://idp.example.com",
      audiences: ["https://okf.example.com/mcp"],
      identityClaims: ["email", "preferred_username", "sub"],
      allowInsecureIssuer: false,
      access: {
        allowedSubjects: [],
        allowedEmails: [],
        requiredGroups: [],
        groupsClaim: "groups",
        allowedClientIds: [],
      },
    });
    expect(config.allowUnauthenticatedNetwork).toBe(false);
    expect(config.trustProxy).toBe("loopback,linklocal,uniquelocal");
    expect(config.gitSyncIntervalSeconds).toBe(60);
    expect(config.hubProject).toBe("org");
  });

  it("defaults AUTH_MODE to oidc", () => {
    const config = loadConfig(required);
    expect(config.auth.mode).toBe("oidc");
  });

  it("loads with loopback HOST when AUTH_MODE=none", () => {
    const config = loadConfig({ PUBLIC_BASE_URL: "https://okf.example.com", AUTH_MODE: "none", HOST: "127.0.0.1" });
    expect(config.auth).toEqual({ mode: "none" });
    expect(config.allowUnauthenticatedNetwork).toBe(false);
  });

  it("ignores malformed OIDC variables when AUTH_MODE=none", () => {
    const config = loadConfig({
      PUBLIC_BASE_URL: "https://okf.example.com",
      AUTH_MODE: "none",
      HOST: "127.0.0.1",
      OAUTH_ALLOW_INSECURE_ISSUER: "yes",
      OAUTH_JWKS_URI: "not a url",
      OAUTH_ISSUER: "not a url",
    });
    expect(config.auth).toEqual({ mode: "none" });
  });

  it("throws when AUTH_MODE=none with default HOST (0.0.0.0)", () => {
    expect(() => loadConfig({ PUBLIC_BASE_URL: "https://okf.example.com", AUTH_MODE: "none" })).toThrow(
      "AUTH_MODE=none requires a loopback HOST (127.0.0.0/8, ::1, localhost); set ALLOW_UNAUTHENTICATED_NETWORK=true only behind a loopback-only port mapping",
    );
  });

  it("throws when AUTH_MODE=none with non-loopback HOST 0.0.0.0 explicitly", () => {
    expect(() =>
      loadConfig({ PUBLIC_BASE_URL: "https://okf.example.com", AUTH_MODE: "none", HOST: "0.0.0.0" }),
    ).toThrow(
      "AUTH_MODE=none requires a loopback HOST (127.0.0.0/8, ::1, localhost); set ALLOW_UNAUTHENTICATED_NETWORK=true only behind a loopback-only port mapping",
    );
  });

  it("loads AUTH_MODE=none with 0.0.0.0 when ALLOW_UNAUTHENTICATED_NETWORK=true", () => {
    const config = loadConfig({
      PUBLIC_BASE_URL: "https://okf.example.com",
      AUTH_MODE: "none",
      ALLOW_UNAUTHENTICATED_NETWORK: "true",
    });
    expect(config.auth).toEqual({ mode: "none" });
    expect(config.allowUnauthenticatedNetwork).toBe(true);
  });

  it.each(["localhost", "127.0.0.1", "127.2.3.4", "::1", "[::1]"])(
    "loads AUTH_MODE=none with loopback host %s",
    (host) => {
      const config = loadConfig({ PUBLIC_BASE_URL: "https://okf.example.com", AUTH_MODE: "none", HOST: host });
      expect(config.auth).toEqual({ mode: "none" });
    },
  );

  it("rejects invalid AUTH_MODE with the message", () => {
    expect(() => loadConfig({ ...required, AUTH_MODE: "invalid" })).toThrow("AUTH_MODE must be oidc or none");
  });

  it("rejects AUTH_MODE=oidc without OAUTH_ISSUER", () => {
    expect(() => loadConfig({ PUBLIC_BASE_URL: "https://okf.example.com", AUTH_MODE: "oidc" })).toThrow(
      "OAUTH_ISSUER is required",
    );
  });

  it.each([
    ["PORT", "8080junk"],
    ["PORT", "65536"],
    ["MAX_FILE_BYTES", "1x"],
    ["MAX_FILE_BYTES", "0"],
    ["GIT_SYNC_INTERVAL_SECONDS", "1.5"],
    ["OAUTH_ALLOW_INSECURE_ISSUER", "yes"],
    ["ALLOW_UNAUTHENTICATED_NETWORK", "yes"],
    ["LOG_LEVEL", "verbose"],
    ["DATA_DIR", "relative/path"],
    ["DEFAULT_STALE_AFTER_DAYS", "0"],
    ["DEFAULT_STALE_AFTER_DAYS", "36501"],
    ["DEFAULT_STALE_AFTER_DAYS", "abc"],
    ["DEFAULT_STALE_AFTER_DAYS", "1.5"],
  ])("rejects %s=%s naming the variable", (name, value) => {
    expect(() => loadConfig({ ...required, [name]: value })).toThrow(name);
  });

  it("reports every missing required variable at once", () => {
    expect(() => loadConfig({})).toThrow(/PUBLIC_BASE_URL[\s\S]*OAUTH_ISSUER/);
  });

  it("requires HTTP credentials together", () => {
    expect(() => loadConfig({ ...required, GIT_HTTP_USERNAME: "u" })).toThrow("GIT_HTTP_USERNAME");
    expect(loadConfig({ ...required, GIT_HTTP_USERNAME: "u", GIT_HTTP_PASSWORD: "p" }).gitHttpPassword).toBe("p");
  });

  it.each(["http://example.com/repo.git", "git://example.com/repo.git", "relative/path"])(
    "rejects invalid remote URL %s",
    (url) => {
      expect(() => loadConfig({ ...required, GIT_REMOTE_URL: url })).toThrow(
        "GIT_REMOTE_URL must be https://, ssh://, user@host:path, file:// or an absolute path",
      );
    },
  );

  it.each([
    "https://example.com/repo.git",
    "ssh://git@example.com/repo.git",
    "git@github.com:o/r.git",
    "file:///x",
    "/abs",
  ])("accepts valid remote URL %s", (url) => {
    expect(loadConfig({ ...required, GIT_REMOTE_URL: url }).gitRemoteUrl).toBe(url);
  });

  it("rejects GIT_SSH_KEY_PATH without GIT_SSH_KNOWN_HOSTS_PATH", () => {
    expect(() => loadConfig({ ...required, GIT_SSH_KEY_PATH: "/path/to/key" })).toThrow(
      "GIT_SSH_KNOWN_HOSTS_PATH is required when GIT_SSH_KEY_PATH is set",
    );
  });

  it("loads optional DEFAULT_STALE_AFTER_DAYS when unset, empty, or valid", () => {
    expect(loadConfig(required).defaultStaleAfterDays).toBeUndefined();
    expect(loadConfig({ ...required, DEFAULT_STALE_AFTER_DAYS: "" }).defaultStaleAfterDays).toBeUndefined();
    expect(loadConfig({ ...required, DEFAULT_STALE_AFTER_DAYS: "180" }).defaultStaleAfterDays).toBe(180);
    expect(loadConfig({ ...required, DEFAULT_STALE_AFTER_DAYS: "1" }).defaultStaleAfterDays).toBe(1);
    expect(loadConfig({ ...required, DEFAULT_STALE_AFTER_DAYS: "36500" }).defaultStaleAfterDays).toBe(36500);
  });

  describe("TRUST_PROXY parsing", () => {
    it("defaults to loopback,linklocal,uniquelocal", () => {
      const config = loadConfig(required);
      expect(config.trustProxy).toBe("loopback,linklocal,uniquelocal");
    });

    it("parses 'true' and 'false' as booleans", () => {
      expect(loadConfig({ ...required, TRUST_PROXY: "true" }).trustProxy).toBe(true);
      expect(loadConfig({ ...required, TRUST_PROXY: "false" }).trustProxy).toBe(false);
    });

    it("parses non-negative integers as numbers", () => {
      expect(loadConfig({ ...required, TRUST_PROXY: "2" }).trustProxy).toBe(2);
      expect(loadConfig({ ...required, TRUST_PROXY: "0" }).trustProxy).toBe(0);
    });

    it("preserves CIDR and arbitrary strings", () => {
      expect(loadConfig({ ...required, TRUST_PROXY: "10.0.0.0/8" }).trustProxy).toBe("10.0.0.0/8");
      expect(loadConfig({ ...required, TRUST_PROXY: "127.0.0.1, 192.168.0.0/16" }).trustProxy).toBe(
        "127.0.0.1, 192.168.0.0/16",
      );
    });
  });

  describe("OAUTH_JWKS_URI security", () => {
    it("rejects http OAUTH_JWKS_URI by default", () => {
      expect(() =>
        loadConfig({
          ...required,
          OAUTH_JWKS_URI: "http://idp.example.com/jwks",
        }),
      ).toThrow("OAUTH_JWKS_URI must be https unless OAUTH_ALLOW_INSECURE_ISSUER=true");
    });

    it("allows http OAUTH_JWKS_URI when OAUTH_ALLOW_INSECURE_ISSUER=true", () => {
      const config = loadConfig({
        ...required,
        OAUTH_JWKS_URI: "http://idp.example.com/jwks",
        OAUTH_ALLOW_INSECURE_ISSUER: "true",
      });
      if (config.auth.mode !== "oidc") {
        expect.unreachable("expected oidc mode");
      }
      expect(config.auth.jwksUri).toBe("http://idp.example.com/jwks");
    });

    it("allows https OAUTH_JWKS_URI", () => {
      const config = loadConfig({
        ...required,
        OAUTH_JWKS_URI: "https://idp.example.com/jwks",
      });
      if (config.auth.mode !== "oidc") {
        expect.unreachable("expected oidc mode");
      }
      expect(config.auth.jwksUri).toBe("https://idp.example.com/jwks");
    });
  });

  describe("AccessPolicy parsing", () => {
    it("defaults to empty lists and groups claim 'groups'", () => {
      const config = loadConfig(required);
      if (config.auth.mode !== "oidc") {
        expect.unreachable("expected oidc mode");
      }
      expect(config.auth.access).toEqual({
        allowedSubjects: [],
        allowedEmails: [],
        requiredGroups: [],
        groupsClaim: "groups",
        allowedClientIds: [],
      });
    });

    it("parses comma-separated values, trims whitespace, drops empties, and lowercases emails", () => {
      const config = loadConfig({
        ...required,
        OAUTH_ALLOWED_SUBJECTS: " sub1, , sub2 ",
        OAUTH_ALLOWED_EMAILS: " User.One@Example.com, , USER.TWO@EXAMPLE.COM ",
        OAUTH_REQUIRED_GROUPS: " admin, staff ",
        OAUTH_GROUPS_CLAIM: "roles",
        OAUTH_ALLOWED_CLIENT_IDS: " client-1, client-2 ",
      });
      if (config.auth.mode !== "oidc") {
        expect.unreachable("expected oidc mode");
      }
      expect(config.auth.access).toEqual({
        allowedSubjects: ["sub1", "sub2"],
        allowedEmails: ["user.one@example.com", "user.two@example.com"],
        requiredGroups: ["admin", "staff"],
        groupsClaim: "roles",
        allowedClientIds: ["client-1", "client-2"],
      });
    });
  });

  describe("hubProject", () => {
    it("defaults to org and loads custom value", () => {
      expect(loadConfig(required).hubProject).toBe("org");
      expect(loadConfig({ ...required, HUB_PROJECT: "corp" }).hubProject).toBe("corp");
      expect(loadConfig({ ...required, HUB_PROJECT: "   " }).hubProject).toBe("org");
    });
  });
});
