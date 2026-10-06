import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { PassThrough, Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import * as tar from "tar";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig, loadStorageConfig } from "../src/config.js";
import { type DevIssuer, startDevIssuer } from "../src/dev/issuer.js";
import type { UiClientConfig } from "../src/http/ui.js";
import { type RunningServer, startLocalHost, startServer } from "../src/server.js";
import { type RunningStdioProxy, startStdioProxy } from "../src/stdio-proxy.js";
import { VERSION } from "../src/version.js";
import {
  buildAuthorizationUrl,
  completeAuthorization,
  discoverAuth,
  type KeyValueStore,
  resolveClientId,
} from "../web/src/auth/flow.js";

const PUBLIC = "http://okf.test";

let issuer: DevIssuer;
let server: RunningServer;
let dataDir: string;
let uiDir: string;

beforeAll(async () => {
  issuer = await startDevIssuer({ audience: `${PUBLIC}/mcp` });
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "okf-"));
  uiDir = await fs.mkdtemp(path.join(os.tmpdir(), "okf-"));
  await fs.mkdir(path.join(uiDir, "assets"));
  await fs.writeFile(path.join(uiDir, "index.html"), "<!doctype html><title>e2e</title>");
  await fs.writeFile(path.join(uiDir, "assets", "app.js"), "export {};");
  server = await startServer(
    loadConfig({
      PORT: "0",
      HOST: "127.0.0.1",
      DATA_DIR: dataDir,
      PUBLIC_BASE_URL: PUBLIC,
      OAUTH_ISSUER: issuer.url,
      OAUTH_ALLOW_INSECURE_ISSUER: "true",
      OAUTH_UI_CLIENT_ID: "okf-web",
      LOG_LEVEL: "silent",
    }),
    { uiDir },
  );
});

afterAll(async () => {
  await server?.close();
  await issuer?.close();
  if (dataDir) await fs.rm(dataDir, { recursive: true, force: true });
  if (uiDir) await fs.rm(uiDir, { recursive: true, force: true });
});

async function connect(token: string): Promise<Client> {
  const client = new Client({ name: "e2e", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${server.url}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  return client;
}
async function connectAnonymous(serverUrl: string): Promise<Client> {
  const client = new Client({ name: "e2e", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${serverUrl}/mcp`)));
  return client;
}

const ALL_TOOLS = [
  "create_project",
  "delete_concept",
  "delete_file",
  "delete_project",
  "get_history",
  "get_index",
  "lint_project",
  "list_projects",
  "read_concept",
  "read_file",
  "search_concepts",
  "submit_feedback",
  "sync_now",
  "verify_concept",
  "write_concept",
  "write_file",
].sort();

interface ToolResult<T> {
  isError?: boolean;
  content: Array<{ type: string; text: string }>;
  structuredContent: T;
}

async function call<T = unknown>(client: Client, name: string, args: Record<string, unknown>): Promise<ToolResult<T>> {
  const result = await client.callTool({ name, arguments: args });
  // The tool returns its JSON result as structuredContent; the test asserts only the fields it names in T.
  return result as unknown as ToolResult<T>;
}

describe("ok-fine end to end", () => {
  it("challenges unauthenticated MCP requests with resource metadata", async () => {
    const res = await fetch(`${server.url}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(401);
    const challenge = res.headers.get("www-authenticate") ?? "";
    expect(challenge).toContain(`resource_metadata="${PUBLIC}/.well-known/oauth-protected-resource/mcp"`);
    expect(challenge).toContain('scope="okf:read okf:write"');
  });

  it("publishes protected resource metadata", async () => {
    const res = await fetch(`${server.url}/.well-known/oauth-protected-resource/mcp`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.resource).toBe(`${PUBLIC}/mcp`);
    expect(body.authorization_servers).toEqual([issuer.url]);
    expect(body.scopes_supported).toEqual(["okf:read", "okf:write", "okf:admin"]);
  });

  it("lists only read tools for a read-only token", async () => {
    const client = await connect(await issuer.mintToken({ scope: "okf:read" }));
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        "get_history",
        "get_index",
        "lint_project",
        "list_projects",
        "read_concept",
        "read_file",
        "search_concepts",
        "submit_feedback",
      ].sort(),
    );
    await client.close();
  });

  it("creates, writes, reads, searches, and verifies over MCP", async () => {
    // The IdP issues both preferred_username and email; human: actors bind to the email.
    const client = await connect(
      await issuer.mintToken({
        scope: "okf:read okf:write okf:admin",
        username: "alice",
        claims: { email: "Alice@Example.com", email_verified: true },
      }),
    );
    const created = await call(client, "create_project", { project: "demo", title: "Demo", actor: "e2e/1.0" });
    expect(created.isError).toBeFalsy();

    const written = await call(client, "write_concept", {
      project: "demo",
      id: "tables/orders",
      frontmatter: {
        type: "Reference",
        title: "Orders",
        description: "Orders table notes",
        tags: ["sales"],
        sources: [{ id: "doc", resource: "https://example.com/orders" }],
      },
      body: "# Orders\n\nOne row per order.[^doc]\n",
      actor: "e2e/1.0",
    });
    expect(written.isError).toBeFalsy();

    const read = await call<{
      derived: { trustTier: string; generatedBy: string };
      issues: Array<{ severity: string }>;
    }>(client, "read_concept", { project: "demo", id: "tables/orders" });
    expect(read.structuredContent.derived.trustTier).toBe("unverified");
    expect(read.structuredContent.derived.generatedBy).toBe("e2e/1.0");
    expect(read.structuredContent.issues.filter((i) => i.severity !== "info")).toEqual([]);

    const found = await call<{ results: Array<{ id: string }> }>(client, "search_concepts", { query: "orders" });
    expect(found.structuredContent.results[0]?.id).toBe("tables/orders");

    const verified = await call<{ trustTier: string }>(client, "verify_concept", {
      project: "demo",
      id: "tables/orders",
      actor: "human:alice@example.com",
    });
    expect(verified.structuredContent.trustTier).toBe("human-reviewed");
    const author = execFileSync("git", ["log", "-1", "--format=%an <%ae>"], { cwd: path.join(dataDir, "repo") });
    expect(author.toString("utf8").trim()).toBe("human:alice@example.com <alice@example.com>");

    const forged = await call(client, "verify_concept", { project: "demo", id: "tables/orders", actor: "human:alice" });
    expect(forged.isError).toBe(true);
    expect(forged.content[0]?.text).toBe("forbidden_actor: this token may only act as human:Alice@Example.com");
    await client.close();
  });

  it("exports the project archive over REST", async () => {
    const token = await issuer.mintToken({ scope: "okf:read" });
    const res = await fetch(`${server.url}/api/v1/projects/demo/archive`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/gzip");
    const paths: string[] = [];
    const archive = Buffer.from(await res.arrayBuffer());
    await pipeline(Readable.from(archive), tar.t({ onReadEntry: (entry) => paths.push(entry.path) }));
    expect(paths).toEqual(
      expect.arrayContaining([
        "demo/index.md",
        "demo/log.md",
        "demo/overview.md",
        "demo/tables/index.md",
        "demo/tables/orders.md",
      ]),
    );
  });

  it("rejects REST writes from a read-only token with insufficient_scope", async () => {
    const token = await issuer.mintToken({ scope: "okf:read" });
    const res = await fetch(`${server.url}/api/v1/projects/demo/concepts/x`, {
      method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-okf-actor": "e2e/1.0" },
      body: JSON.stringify({ frontmatter: { type: "Reference" }, body: "x" }),
    });
    expect(res.status).toBe(403);
    const challenge = res.headers.get("www-authenticate") ?? "";
    expect(challenge).toContain("insufficient_scope");
    expect(challenge).toContain('scope="okf:write"');
  });

  it("rejects unauthenticated request with large body immediately without buffering", async () => {
    const url = new URL(server.url);
    const result = await new Promise<string>((resolve, reject) => {
      const client = net.connect({ port: Number(url.port), host: url.hostname }, () => {
        client.write(
          "PUT /api/v1/projects/demo/archive HTTP/1.1\r\n" +
            `Host: ${url.host}\r\n` +
            "Content-Type: application/gzip\r\n" +
            "Content-Length: 40000000\r\n" +
            "Connection: close\r\n" +
            "\r\n" +
            "partial",
        );
      });
      let response = "";
      client.on("data", (chunk) => {
        response += chunk.toString("utf-8");
        if (response.includes("HTTP/1.1 401")) {
          client.destroy();
          resolve(response);
        }
      });
      client.on("error", reject);
      client.on("close", () => {
        if (response.includes("HTTP/1.1 401")) {
          resolve(response);
        } else {
          reject(new Error(`Expected 401, got: ${response}`));
        }
      });
    });
    expect(result).toContain("HTTP/1.1 401");
    expect(result).toContain("www-authenticate");
  });
});

describe("web UI", () => {
  const redirectUri = `${PUBLIC}/ui/callback`;
  const memoryStore = (): KeyValueStore & { size(): number } => {
    const map = new Map<string, string>();
    return {
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => void map.set(k, v),
      removeItem: (k) => void map.delete(k),
      size: () => map.size,
    };
  };

  it("serves client config", async () => {
    const res = await fetch(`${server.url}/ui/config.json`);
    expect(await res.json()).toEqual({
      authMode: "oidc",
      oauthClientId: "okf-web",
      scope: "okf:read",
      version: VERSION,
    });
  });

  it("serves the SPA with the IdP token endpoint in connect-src and keeps the API protected", async () => {
    const page = await fetch(`${server.url}/ui/p/demo/c/x`);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");
    expect(page.headers.get("content-security-policy")).toContain(`connect-src 'self' ${issuer.url}`);
    const api = await fetch(`${server.url}/api/v1/projects`);
    expect(api.status).toBe(401);
  });

  it("signs in with authorization code + PKCE through the same discovery MCP clients use", async () => {
    const discovery = await discoverAuth(server.url);
    expect(discovery.resource).toBe(`${PUBLIC}/mcp`);
    const config: UiClientConfig = { authMode: "oidc", oauthClientId: "okf-web", scope: "okf:read", version: VERSION };

    const configuredStore = memoryStore();
    expect(await resolveClientId(discovery, config, redirectUri, configuredStore)).toBe("okf-web");
    expect(configuredStore.size()).toBe(0);

    const dcrStore = memoryStore();
    const dcrConfig = { ...config, oauthClientId: null };
    const clientId = await resolveClientId(discovery, dcrConfig, redirectUri, dcrStore);
    expect(clientId).toMatch(/^dev-/);
    expect(dcrStore.size()).toBe(1);
    expect(await resolveClientId(discovery, dcrConfig, redirectUri, dcrStore)).toBe(clientId);

    const authorize = async () => {
      const { url, pending } = await buildAuthorizationUrl(discovery, clientId, redirectUri, "okf:read", "/");
      const res = await fetch(url, { redirect: "manual" });
      expect(res.status).toBe(302);
      return { pending, callback: new URL(res.headers.get("location") ?? "") };
    };

    const first = await authorize();
    const token = await completeAuthorization(discovery, first.pending, first.callback);
    const projects = await fetch(`${server.url}/api/v1/projects`, {
      headers: { authorization: `Bearer ${token.accessToken}` },
    });
    expect(projects.status).toBe(200);

    const second = await authorize();
    await expect(
      completeAuthorization(discovery, { ...second.pending, state: "tampered" }, second.callback),
    ).rejects.toThrow();
  });
});

describe("ok-fine with AUTH_MODE=none", () => {
  let noneServer: RunningServer;
  let noneDataDir: string;

  beforeAll(async () => {
    noneDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "okf-"));
    noneServer = await startServer(
      loadConfig({
        AUTH_MODE: "none",
        PORT: "0",
        HOST: "127.0.0.1",
        DATA_DIR: noneDataDir,
        PUBLIC_BASE_URL: PUBLIC,
        LOG_LEVEL: "silent",
      }),
      { uiDir },
    );
  });

  afterAll(async () => {
    await noneServer?.close();
    if (noneDataDir) await fs.rm(noneDataDir, { recursive: true, force: true });
  });

  it("connects with no Authorization header and lists all tools including write and admin tools", async () => {
    const client = await connectAnonymous(noneServer.url);
    const { tools } = await client.listTools();
    const toolNames = tools.map((t) => t.name).sort();
    expect(toolNames).toEqual(ALL_TOOLS);
    expect(toolNames).toEqual(
      expect.arrayContaining(["create_project", "write_concept", "delete_project", "sync_now"]),
    );
    await client.close();
  });

  it("creates a project via MCP with actor e2e/1.0", async () => {
    const client = await connectAnonymous(noneServer.url);
    const created = await call(client, "create_project", {
      project: "insecure-demo",
      title: "Insecure Demo",
      actor: "e2e/1.0",
    });
    expect(created.isError).toBeFalsy();
    await client.close();
  });

  it("rejects REST write with human:dev actor with 403 forbidden_actor", async () => {
    const res = await fetch(`${noneServer.url}/api/v1/projects/insecure-demo/concepts/notes`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-okf-actor": "human:dev",
      },
      body: JSON.stringify({
        frontmatter: { type: "Reference" },
        body: "# Notes\n",
      }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("forbidden_actor");
  });

  it("returns 404 for oauth-protected-resource endpoint", async () => {
    const res = await fetch(`${noneServer.url}/.well-known/oauth-protected-resource/mcp`);
    expect(res.status).toBe(404);
  });

  it("rejects requests with forbidden Host header in AUTH_MODE=none", async () => {
    const url = new URL(noneServer.url);
    const res = await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
      const req = http.request(
        {
          host: url.hostname,
          port: url.port,
          path: "/api/v1/projects",
          method: "GET",
          headers: { Host: "evil.example" },
        },
        (r) => {
          let body = "";
          r.on("data", (chunk) => (body += chunk));
          r.on("end", () => resolve({ statusCode: r.statusCode ?? 0, body }));
        },
      );
      req.on("error", reject);
      req.end();
    });
    expect(res.statusCode).toBe(403);
    const json = JSON.parse(res.body) as { error?: { code?: string } };
    expect(json.error?.code).toBe("forbidden");
  });

  it("rejects requests to /ui/ with forbidden Host header in AUTH_MODE=none", async () => {
    const url = new URL(noneServer.url);
    const res = await new Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: string }>(
      (resolve, reject) => {
        const req = http.request(
          {
            host: url.hostname,
            port: url.port,
            path: "/ui/",
            method: "GET",
            headers: { Host: "evil.example" },
          },
          (r) => {
            let body = "";
            r.on("data", (chunk) => (body += chunk));
            r.on("end", () => resolve({ statusCode: r.statusCode ?? 0, headers: r.headers, body }));
          },
        );
        req.on("error", reject);
        req.end();
      },
    );
    expect(res.statusCode).toBe(403);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    const json = JSON.parse(res.body) as { error?: { code?: string } };
    expect(json.error?.code).toBe("forbidden");
  });

  it("rejects requests with forbidden Origin header in AUTH_MODE=none", async () => {
    const res = await fetch(`${noneServer.url}/api/v1/projects`, {
      headers: { origin: "http://evil.example" },
    });
    expect(res.status).toBe(403);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe("forbidden");
  });

  it("accepts requests with localhost Host header in AUTH_MODE=none", async () => {
    const url = new URL(noneServer.url);
    const res = await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
      const req = http.request(
        {
          host: url.hostname,
          port: url.port,
          path: "/api/v1/projects",
          method: "GET",
          headers: { Host: `localhost:${url.port}` },
        },
        (r) => {
          let body = "";
          r.on("data", (chunk) => (body += chunk));
          r.on("end", () => resolve({ statusCode: r.statusCode ?? 0, body }));
        },
      );
      req.on("error", reject);
      req.end();
    });
    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body) as { projects?: unknown[] };
    expect(json.projects).toBeDefined();
  });

  it("exempts GET /healthz from Host validation for kubelet probes in AUTH_MODE=none", async () => {
    const url = new URL(noneServer.url);
    const res = await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
      const req = http.request(
        {
          host: url.hostname,
          port: url.port,
          path: "/healthz",
          method: "GET",
          headers: { Host: "10.0.0.5:8080" },
        },
        (r) => {
          let body = "";
          r.on("data", (chunk) => (body += chunk));
          r.on("end", () => resolve({ statusCode: r.statusCode ?? 0, body }));
        },
      );
      req.on("error", reject);
      req.end();
    });
    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body) as { status?: string };
    expect(json.status).toBe("ok");
  });

  it("serves client config with auth off", async () => {
    const res = await fetch(`${noneServer.url}/ui/config.json`);
    expect(await res.json()).toEqual({ authMode: "none", oauthClientId: null, scope: "okf:read", version: VERSION });
  });
});

describe("ok-fine over stdio", () => {
  const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
  const clientToServer = new PassThrough();
  const serverToClient = new PassThrough();
  let stdioServer: RunningStdioProxy;
  let stdioDataDir: string;
  let client: Client;

  beforeAll(async () => {
    stdioDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "okf-"));
    const config = loadStorageConfig({ DATA_DIR: stdioDataDir, LOG_LEVEL: "silent" });
    stdioServer = await startStdioProxy({
      config,
      log: silent,
      identity: "dev@example.com",
      startHost: () => startLocalHost(config, { log: silent }),
      stdin: clientToServer,
      stdout: serverToClient,
    });
    client = new Client({ name: "e2e-stdio", version: "1.0.0" });
    // NDJSON framing is symmetric, and the SDK's client stdio transport only spawns processes.
    await client.connect(new StdioServerTransport(serverToClient, clientToServer));
  });

  afterAll(async () => {
    await stdioServer?.close();
    if (stdioDataDir) await fs.rm(stdioDataDir, { recursive: true, force: true });
  });

  it("serves every tool and binds human actors to the local git identity", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(ALL_TOOLS);

    const created = await call(client, "create_project", {
      project: "local",
      title: "Local",
      actor: "human:dev@example.com",
    });
    expect(created.isError).toBeFalsy();

    const forged = await call<{ error: { code: string; message: string } }>(client, "create_project", {
      project: "other",
      title: "Other",
      actor: "human:other@example.com",
    });
    expect(forged.isError).toBe(true);
    expect(forged.structuredContent.error.code).toBe("forbidden_actor");
    expect(forged.structuredContent.error.message).toBe("this token may only act as human:dev@example.com");
  });

  it("finishes when the client closes stdin", async () => {
    clientToServer.end();
    await stdioServer.done;
    await stdioServer.close();
  });
});
