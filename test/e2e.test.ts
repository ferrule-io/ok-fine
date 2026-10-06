import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import * as tar from "tar";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { type DevIssuer, startDevIssuer } from "../src/dev/issuer.js";
import { type RunningServer, startServer } from "../src/server.js";

const PUBLIC = "http://okf.test";

let issuer: DevIssuer;
let server: RunningServer;
let dataDir: string;

beforeAll(async () => {
  issuer = await startDevIssuer({ audience: `${PUBLIC}/mcp` });
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "okf-"));
  server = await startServer(
    loadConfig({
      PORT: "0",
      HOST: "127.0.0.1",
      DATA_DIR: dataDir,
      PUBLIC_BASE_URL: PUBLIC,
      OAUTH_ISSUER: issuer.url,
      OAUTH_ALLOW_INSECURE_ISSUER: "true",
      LOG_LEVEL: "silent",
    }),
  );
});

afterAll(async () => {
  await server?.close();
  await issuer?.close();
  if (dataDir) await fs.rm(dataDir, { recursive: true, force: true });
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
        claims: { email: "Alice@Example.com" },
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
});
