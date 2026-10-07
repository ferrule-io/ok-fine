import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";
import { startServer } from "../server.js";
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
    await fs.writeFile(path.join(dir, "favicon.svg"), "<svg></svg>");
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

  it("serves index.html with exact security headers for SPA deep links", async () => {
    expect(await register()).toBe(true);
    const res = await app.inject({ method: "GET", url: "/ui/p/demo/c/a/b" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("<!doctype html><title>fixture</title>");
    expect(res.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(res.headers["cache-control"]).toBe("no-cache");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["cross-origin-opener-policy"]).toBe("same-origin");
    expect(res.headers["permissions-policy"]).toBe("camera=(), display-capture=(), geolocation=(), microphone=()");
    expect(res.headers["content-security-policy"]).toBe(
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' https://idp.example.com; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; upgrade-insecure-requests",
    );
  });

  it("omits upgrade-insecure-requests from CSP when publicBaseUrl is plain HTTP", async () => {
    const httpApp = Fastify();
    try {
      await registerUiRoutes(httpApp, {
        dir,
        publicBaseUrl: "http://localhost:8080",
        clientConfig,
        connectSrc: [],
      });
      const res = await httpApp.inject({ method: "GET", url: "/ui/" });
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-security-policy"]).toBe(
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      );
    } finally {
      await httpApp.close();
    }
  });

  it("serves hashed assets as immutable with security headers and 404s unknown files", async () => {
    await register();
    const asset = await app.inject({ method: "GET", url: "/ui/assets/app-abc123.js" });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers["content-type"]).toBe("text/javascript; charset=utf-8");
    expect(asset.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(asset.headers["referrer-policy"]).toBe("no-referrer");
    expect(asset.headers["x-frame-options"]).toBe("DENY");
    expect(asset.headers["x-content-type-options"]).toBe("nosniff");
    expect(asset.headers["cross-origin-opener-policy"]).toBe("same-origin");
    expect(asset.headers["permissions-policy"]).toBe("camera=(), display-capture=(), geolocation=(), microphone=()");
    expect(asset.headers["content-security-policy"]).toBe("frame-ancestors 'none'");

    const missing = await app.inject({ method: "GET", url: "/ui/assets/missing.js" });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe("not_found");
    expect(missing.headers["content-type"]).toBe("application/json; charset=utf-8");
    expect(missing.headers["cache-control"]).toBe("no-cache");
    expect(missing.headers["referrer-policy"]).toBe("no-referrer");
    expect(missing.headers["x-frame-options"]).toBe("DENY");
    expect(missing.headers["x-content-type-options"]).toBe("nosniff");
    expect(missing.headers["cross-origin-opener-policy"]).toBe("same-origin");
    expect(missing.headers["permissions-policy"]).toBe("camera=(), display-capture=(), geolocation=(), microphone=()");
    expect(missing.headers["content-security-policy"]).toBe("frame-ancestors 'none'");
  });

  it("serves root SVG assets with restrictive CSP and non-immutable caching", async () => {
    await register();
    const svg = await app.inject({ method: "GET", url: "/ui/favicon.svg" });
    expect(svg.statusCode).toBe(200);
    expect(svg.headers["content-type"]).toBe("image/svg+xml");
    expect(svg.headers["cache-control"]).toBe("no-cache");
    expect(svg.headers["referrer-policy"]).toBe("no-referrer");
    expect(svg.headers["x-frame-options"]).toBe("DENY");
    expect(svg.headers["x-content-type-options"]).toBe("nosniff");
    expect(svg.headers["cross-origin-opener-policy"]).toBe("same-origin");
    expect(svg.headers["permissions-policy"]).toBe("camera=(), display-capture=(), geolocation=(), microphone=()");
    expect(svg.headers["content-security-policy"]).toBe("default-src 'none'; style-src 'unsafe-inline'; sandbox");
  });

  it("serves client config uncached with security headers and redirects with security headers", async () => {
    await register();
    const config = await app.inject({ method: "GET", url: "/ui/config.json" });
    expect(config.statusCode).toBe(200);
    expect(config.json()).toEqual(clientConfig);
    expect(config.headers["content-type"]).toBe("application/json; charset=utf-8");
    expect(config.headers["cache-control"]).toBe("no-store");
    expect(config.headers["referrer-policy"]).toBe("no-referrer");
    expect(config.headers["x-frame-options"]).toBe("DENY");
    expect(config.headers["x-content-type-options"]).toBe("nosniff");
    expect(config.headers["cross-origin-opener-policy"]).toBe("same-origin");
    expect(config.headers["permissions-policy"]).toBe("camera=(), display-capture=(), geolocation=(), microphone=()");
    expect(config.headers["content-security-policy"]).toBe("frame-ancestors 'none'");

    const root = await app.inject({ method: "GET", url: "/" });
    expect(root.statusCode).toBe(302);
    expect(root.headers.location).toBe("/ui/");
    expect(root.headers["referrer-policy"]).toBe("no-referrer");
    expect(root.headers["x-frame-options"]).toBe("DENY");
    expect(root.headers["x-content-type-options"]).toBe("nosniff");
    expect(root.headers["cross-origin-opener-policy"]).toBe("same-origin");
    expect(root.headers["permissions-policy"]).toBe("camera=(), display-capture=(), geolocation=(), microphone=()");
    expect(root.headers["content-security-policy"]).toBe("frame-ancestors 'none'");

    const bare = await app.inject({ method: "GET", url: "/ui" });
    expect(bare.statusCode).toBe(301);
    expect(bare.headers.location).toBe("/ui/");
    expect(bare.headers["referrer-policy"]).toBe("no-referrer");
    expect(bare.headers["x-frame-options"]).toBe("DENY");
    expect(bare.headers["x-content-type-options"]).toBe("nosniff");
    expect(bare.headers["cross-origin-opener-policy"]).toBe("same-origin");
    expect(bare.headers["permissions-policy"]).toBe("camera=(), display-capture=(), geolocation=(), microphone=()");
    expect(bare.headers["content-security-policy"]).toBe("frame-ancestors 'none'");
  });

  it("rejects requests to /ui/ with foreign Host in AUTH_MODE=none with 403 and exact headers", async () => {
    const noneDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "okf-none-"));
    const server = await startServer(
      loadConfig({
        PORT: "0",
        HOST: "127.0.0.1",
        DATA_DIR: noneDataDir,
        PUBLIC_BASE_URL: "http://127.0.0.1",
        AUTH_MODE: "none",
        LOG_LEVEL: "silent",
      }),
      { uiDir: dir },
    );
    try {
      const res = await server.app.inject({
        method: "GET",
        url: "/ui/",
        headers: { host: "evil.example" },
      });
      expect(res.statusCode).toBe(403);
      expect(res.headers["content-type"]).toBe("application/json; charset=utf-8");
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.json()).toEqual({
        error: {
          code: "forbidden",
          message: "Host header 'evil.example' is not allowed in AUTH_MODE=none",
        },
      });
    } finally {
      await server.close();
      await fs.rm(noneDataDir, { recursive: true, force: true });
    }
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
