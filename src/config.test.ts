import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const required = { PUBLIC_BASE_URL: "https://okf.example.com/", OAUTH_ISSUER: "https://idp.example.com" };

describe("loadConfig", () => {
  it("applies defaults and derives the audience from the public base URL", () => {
    const config = loadConfig(required);
    expect(config.port).toBe(8080);
    expect(config.publicBaseUrl).toBe("https://okf.example.com");
    expect(config.oauthAudiences).toEqual(["https://okf.example.com/mcp"]);
    expect(config.allowInsecureIssuer).toBe(false);
    expect(config.gitSyncIntervalSeconds).toBe(60);
  });

  it.each([
    ["PORT", "8080junk"],
    ["PORT", "65536"],
    ["MAX_FILE_BYTES", "1x"],
    ["MAX_FILE_BYTES", "0"],
    ["GIT_SYNC_INTERVAL_SECONDS", "1.5"],
    ["OAUTH_ALLOW_INSECURE_ISSUER", "yes"],
    ["LOG_LEVEL", "verbose"],
    ["DATA_DIR", "relative/path"],
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
});
