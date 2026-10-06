import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { endpointOrigins, registerUiRoutes, type UiClientConfig } from "./ui.js";

const clientConfig: UiClientConfig = {
  authMode: "oidc",
  oauthClientId: "okf-web",
  scope: "okf:read",
  version: "1.2.3",
};

describe("web UI routes", () => {
  let dir: string;
  let app: FastifyInstance;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "okf-"));
    await fs.mkdir(path.join(dir, "assets"));
    await fs.writeFile(path.join(dir, "index.html"), "<!doctype html><title>fixture</title>");
    await fs.writeFile(path.join(dir, "assets", "app-abc123.js"), "console.log(1)");
    app = Fastify();
  });

  afterEach(async () => {
    await app.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  const register = (uiDir = dir) =>
    registerUiRoutes(app, {
      dir: uiDir,
      publicBaseUrl: "https://okf.example.com",
      clientConfig,
      connectSrc: ["https://idp.example.com"],
    });

  it("serves index.html with CSP for SPA deep links", async () => {
    expect(await register()).toBe(true);
    const res = await app.inject({ method: "GET", url: "/ui/p/demo/c/a/b" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("<!doctype html><title>fixture</title>");
    expect(res.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(res.headers["cache-control"]).toBe("no-cache");
    const csp = String(res.headers["content-security-policy"]);
    expect(csp).toContain("connect-src 'self' https://idp.example.com;");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
  });

  it("serves hashed assets as immutable and 404s unknown files", async () => {
    await register();
    const asset = await app.inject({ method: "GET", url: "/ui/assets/app-abc123.js" });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers["content-type"]).toBe("text/javascript; charset=utf-8");
    expect(asset.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(asset.headers["x-content-type-options"]).toBe("nosniff");

    const missing = await app.inject({ method: "GET", url: "/ui/assets/missing.js" });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe("not_found");
  });

  it("serves client config uncached and redirects the root", async () => {
    await register();
    const config = await app.inject({ method: "GET", url: "/ui/config.json" });
    expect(config.json()).toEqual(clientConfig);
    expect(config.headers["cache-control"]).toBe("no-store");

    const root = await app.inject({ method: "GET", url: "/" });
    expect(root.statusCode).toBe(302);
    expect(root.headers.location).toBe("/ui/");
    const bare = await app.inject({ method: "GET", url: "/ui" });
    expect(bare.statusCode).toBe(301);
    expect(bare.headers.location).toBe("/ui/");
  });

  it("registers nothing when the build is missing", async () => {
    expect(await register(path.join(dir, "absent"))).toBe(false);
    const res = await app.inject({ method: "GET", url: "/ui/" });
    expect(res.statusCode).toBe(404);
  });

  it("registers nothing when index.html is missing", async () => {
    await fs.rm(path.join(dir, "index.html"));
    expect(await register()).toBe(false);
  });
});

describe("endpointOrigins", () => {
  it("dedupes origins and ignores non-URLs", () => {
    expect(
      endpointOrigins("https://a.example/token", "https://a.example/reg", 42, "notaurl", "https://b.example:8443/x"),
    ).toEqual(["https://a.example", "https://b.example:8443"]);
  });
});
