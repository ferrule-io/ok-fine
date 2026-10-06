import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance, FastifyReply } from "fastify";

/** <package>/dist/ui from both src/http (vitest) and dist/http (build). */
export const DEFAULT_UI_DIR = fileURLToPath(new URL("../../dist/ui/", import.meta.url));

export interface UiClientConfig {
  authMode: "oidc" | "none";
  oauthClientId: string | null;
  scope: string;
  version: string;
}

export interface UiRouteOptions {
  dir: string;
  publicBaseUrl: string;
  clientConfig: UiClientConfig;
  /** Extra CSP connect-src origins (the IdP token and registration endpoints). */
  connectSrc: string[];
}

interface Asset {
  body: Buffer;
  type: string;
  cache: string;
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
};

const IMMUTABLE = "public, max-age=31536000, immutable";

/** Unique origins of the string http(s) URLs among `endpoints`; ignores anything else. */
export function endpointOrigins(...endpoints: unknown[]): string[] {
  const origins = new Set<string>();
  for (const endpoint of endpoints) {
    if (typeof endpoint !== "string") continue;
    let url: URL;
    try {
      url = new URL(endpoint);
    } catch {
      continue;
    }
    if (url.protocol === "http:" || url.protocol === "https:") origins.add(url.origin);
  }
  return [...origins];
}

async function loadAssets(dir: string): Promise<Map<string, Asset> | null> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { recursive: true, withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  const assets = new Map<string, Asset>();
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const abs = path.join(entry.parentPath, entry.name);
    const rel = path.relative(dir, abs).split(path.sep).join("/");
    assets.set(rel, {
      body: await readFile(abs),
      type: CONTENT_TYPES[path.extname(entry.name).toLowerCase()] ?? "application/octet-stream",
      cache: rel.startsWith("assets/") ? IMMUTABLE : "no-cache",
    });
  }
  return assets.has("index.html") ? assets : null;
}

/** Serves the built web UI from memory under /ui/. Returns false (and registers nothing) when `<dir>/index.html` is missing. */
export async function registerUiRoutes(app: FastifyInstance, options: UiRouteOptions): Promise<boolean> {
  const assets = await loadAssets(options.dir);
  const index = assets?.get("index.html");
  if (!assets || !index) {
    app.log.warn({ dir: options.dir }, "web UI assets not found; /ui disabled");
    return false;
  }

  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    // Shiki emits inline style attributes.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    `connect-src 'self'${options.connectSrc.map((origin) => ` ${origin}`).join("")}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");

  const sendHtml = (reply: FastifyReply) =>
    reply
      .header("content-type", "text/html; charset=utf-8")
      .header("cache-control", "no-cache")
      .header("referrer-policy", "no-referrer")
      .header("x-frame-options", "DENY")
      .header("x-content-type-options", "nosniff")
      .header("content-security-policy", csp)
      .send(index.body);

  app.get("/", async (_req, reply) => reply.redirect("/ui/", 302));
  app.get("/ui", async (_req, reply) => reply.redirect("/ui/", 301));
  app.get("/ui/config.json", async (_req, reply) =>
    reply.header("cache-control", "no-store").header("x-content-type-options", "nosniff").send(options.clientConfig),
  );
  app.get<{ Params: { "*": string } }>("/ui/*", async (req, reply) => {
    const rel = req.params["*"];
    if (rel === "" || rel === "index.html") return sendHtml(reply);
    const asset = assets.get(rel);
    if (asset) {
      return reply
        .header("content-type", asset.type)
        .header("cache-control", asset.cache)
        .header("x-content-type-options", "nosniff")
        .send(asset.body);
    }
    const last = rel.slice(rel.lastIndexOf("/") + 1);
    if (/\.[A-Za-z0-9]+$/.test(last)) {
      return reply
        .code(404)
        .header("x-content-type-options", "nosniff")
        .send({ error: { code: "not_found", message: "not found" } });
    }
    return sendHtml(reply);
  });

  app.log.info({ url: `${options.publicBaseUrl}/ui/` }, "web UI enabled");
  return true;
}
