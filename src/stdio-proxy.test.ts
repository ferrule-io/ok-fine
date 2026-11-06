import { mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { Client } from "@modelcontextprotocol/client";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig, loadStorageConfig } from "./config.js";
import { lockDataDir, tryLockDataDir } from "./data-dir-lock.js";
import { localEndpointPath } from "./local-host.js";
import { startLocalHost, startServer } from "./server.js";
import { type RunningStdioProxy, startStdioProxy } from "./stdio-proxy.js";

const silent = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  fatal: () => {},
  trace: () => {},
};

async function readLine(stream: PassThrough): Promise<string> {
  const { promise, resolve } = Promise.withResolvers<string>();
  let buffer = "";
  const onData = (chunk: Buffer | string) => {
    buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    const idx = buffer.indexOf("\n");
    if (idx !== -1) {
      stream.off("data", onData);
      resolve(buffer.slice(0, idx).replace(/\r$/, ""));
    }
  };
  stream.on("data", onData);
  return promise;
}

describe("stdio proxy and shared sessions", () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "okf-"));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("two proxies on one data dir both complete initialize and a tool call concurrently", async () => {
    const config = loadStorageConfig({ DATA_DIR: dataDir, LOG_LEVEL: "silent" });

    const in1 = new PassThrough();
    const out1 = new PassThrough();
    const proxy1 = await startStdioProxy({
      config,
      identity: "user1@example.com",
      log: silent,
      stdin: in1,
      stdout: out1,
      startHost: () => startLocalHost(config, { log: silent }),
    });
    const client1 = new Client({ name: "client1", version: "1.0.0" });
    await client1.connect(new StdioServerTransport(out1, in1));

    const in2 = new PassThrough();
    const out2 = new PassThrough();
    const proxy2 = await startStdioProxy({
      config,
      identity: "user2@example.com",
      log: silent,
      stdin: in2,
      stdout: out2,
      startHost: () => startLocalHost(config, { log: silent }),
    });
    const client2 = new Client({ name: "client2", version: "1.0.0" });
    await client2.connect(new StdioServerTransport(out2, in2));

    // Both call list_projects concurrently
    const [res1, res2] = await Promise.all([
      client1.callTool({ name: "list_projects", arguments: {} }),
      client2.callTool({ name: "list_projects", arguments: {} }),
    ]);

    expect(res1.isError).toBeFalsy();
    expect(res2.isError).toBeFalsy();

    in1.end();
    in2.end();
    await Promise.all([proxy1.done, proxy2.done]);
    await Promise.all([proxy1.close(), proxy2.close()]);
  });

  it("failover: three sessions, close host stdin -> follower becomes host and tool call succeeds without client re-initialize", async () => {
    const config = loadStorageConfig({ DATA_DIR: dataDir, LOG_LEVEL: "silent" });

    // Session 1: becomes initial host
    const in1 = new PassThrough();
    const out1 = new PassThrough();
    const proxy1 = await startStdioProxy({
      config,
      identity: "host@example.com",
      log: silent,
      stdin: in1,
      stdout: out1,
      startHost: () => startLocalHost(config, { log: silent }),
    });
    const client1 = new Client({ name: "client1", version: "1.0.0" });
    await client1.connect(new StdioServerTransport(out1, in1));

    // Session 2: follower
    const in2 = new PassThrough();
    const out2 = new PassThrough();
    const proxy2 = await startStdioProxy({
      config,
      identity: "follower1@example.com",
      log: silent,
      stdin: in2,
      stdout: out2,
      startHost: () => startLocalHost(config, { log: silent }),
    });
    const client2 = new Client({ name: "client2", version: "1.0.0" });
    await client2.connect(new StdioServerTransport(out2, in2));

    // Session 3: follower
    const in3 = new PassThrough();
    const out3 = new PassThrough();
    const proxy3 = await startStdioProxy({
      config,
      identity: "follower2@example.com",
      log: silent,
      stdin: in3,
      stdout: out3,
      startHost: () => startLocalHost(config, { log: silent }),
    });
    const client3 = new Client({ name: "client3", version: "1.0.0" });
    await client3.connect(new StdioServerTransport(out3, in3));

    // Verify all three can execute tool calls before failover
    const pre = await client2.callTool({ name: "list_projects", arguments: {} });
    expect(pre.isError).toBeFalsy();

    // Close host's stdin while follower 2 and follower 3 are connected
    const closeStart = Date.now();
    in1.end();
    await proxy1.done;
    await proxy1.close();
    expect(Date.now() - closeStart).toBeLessThan(5000);
    // Subsequent tool call from follower 2 succeeds without re-initializing from client side
    const post2 = await client2.callTool({ name: "list_projects", arguments: {} });
    expect(post2.isError).toBeFalsy();

    // Subsequent tool call from follower 3 also succeeds
    const post3 = await client3.callTool({ name: "list_projects", arguments: {} });
    expect(post3.isError).toBeFalsy();

    in2.end();
    in3.end();
    await Promise.all([proxy2.done, proxy3.done]);
    await Promise.all([proxy2.close(), proxy3.close()]);
  });

  it("answers in-flight requests with -32603 when socket closes during failover", async () => {
    // Start a dummy net server that accepts the connection and hello, then drops the socket on request
    const dummyDir = await mkdtemp(join(tmpdir(), "okf-"));
    const endpoint = localEndpointPath(dummyDir);

    const { promise: connected, resolve: resolveConnected } = Promise.withResolvers<net.Socket>();
    const server = net.createServer((socket) => {
      resolveConnected(socket);
    });

    const { promise: listenPromise, resolve: resolveListen, reject: rejectListen } = Promise.withResolvers<void>();
    server.once("error", rejectListen);
    server.listen(endpoint, () => {
      server.off("error", rejectListen);
      resolveListen();
    });
    await listenPromise;

    const clientIn = new PassThrough();
    const clientOut = new PassThrough();

    // Acquire the data dir lock for the dummy host so the proxy acts as a follower
    const dummyHostLock = await tryLockDataDir(dummyDir);
    expect(dummyHostLock.acquired).toBe(true);

    let proxy: RunningStdioProxy | undefined;
    try {
      proxy = await startStdioProxy({
        config: loadStorageConfig({ DATA_DIR: dummyDir, LOG_LEVEL: "silent" }),
        identity: "tester@example.com",
        log: silent,
        stdin: clientIn,
        stdout: clientOut,
        electionTimeoutMs: 500,
        startHost: () =>
          startLocalHost(loadStorageConfig({ DATA_DIR: dummyDir, LOG_LEVEL: "silent" }), { log: silent }),
      });

      const serverSocket = await connected;
      // Read hello line from proxy
      await new Promise<void>((resolve) => serverSocket.once("data", () => resolve()));
      // Send a request from client that is in-flight
      clientIn.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: 42,
          method: "tools/call",
          params: { name: "list_projects", arguments: {} },
        })}\n`,
      );

      // Now server drops connection without answering request
      server.close();
      serverSocket.destroy();
      // Client should receive the -32603 error line on stdout
      const responseLine = await readLine(clientOut);
      const parsed = JSON.parse(responseLine);
      expect(parsed).toMatchObject({
        id: 42,
        error: {
          code: -32603,
          message: "ok-fine host restarted; retry the request",
        },
      });
    } finally {
      clientIn.end();
      if (proxy) await proxy.close();
      server.close();
      if (dummyHostLock.acquired) dummyHostLock.release();
    }
  });

  it("serializes socket writes: delivered request gets -32603 while queued request is replayed to next host", async () => {
    const dummyDir = await mkdtemp(join(tmpdir(), "okf-"));
    const endpoint = localEndpointPath(dummyDir);

    const { promise: connected1, resolve: resolveConnected1 } = Promise.withResolvers<net.Socket>();
    const server1 = net.createServer((socket) => {
      resolveConnected1(socket);
    });

    const { promise: listenPromise1, resolve: resolveListen1, reject: rejectListen1 } = Promise.withResolvers<void>();
    server1.once("error", rejectListen1);
    server1.listen(endpoint, () => {
      server1.off("error", rejectListen1);
      resolveListen1();
    });
    await listenPromise1;

    const clientIn = new PassThrough();
    const clientOut = new PassThrough();

    // Lock dummyDir so the proxy acts as follower
    const dummyHostLock = await tryLockDataDir(dummyDir);
    expect(dummyHostLock.acquired).toBe(true);

    let server2: net.Server | undefined;
    let proxy: RunningStdioProxy | undefined;

    try {
      proxy = await startStdioProxy({
        config: loadStorageConfig({ DATA_DIR: dummyDir, LOG_LEVEL: "silent" }),
        identity: "tester@example.com",
        log: silent,
        stdin: clientIn,
        stdout: clientOut,
        electionTimeoutMs: 2000,
        startHost: async () => {
          const {
            promise: listenPromise2,
            resolve: resolveListen2,
            reject: rejectListen2,
          } = Promise.withResolvers<void>();
          server2 = net.createServer((socket) => {
            let buf = "";
            socket.on("data", (chunk) => {
              buf += chunk.toString("utf8");
              while (true) {
                const idx = buf.indexOf("\n");
                if (idx === -1) break;
                const line = buf.slice(0, idx).trim();
                buf = buf.slice(idx + 1);
                if (!line) continue;
                const parsed = JSON.parse(line);
                if (parsed.okFine) continue; // hello
                if (parsed.method === "initialize") {
                  socket.write(
                    `${JSON.stringify({
                      jsonrpc: "2.0",
                      id: parsed.id,
                      result: { protocolVersion: "2025-11-25" },
                    })}\n`,
                  );
                } else if (parsed.method === "notifications/initialized") {
                  // notification
                } else if (parsed.id !== undefined) {
                  socket.write(
                    `${JSON.stringify({
                      jsonrpc: "2.0",
                      id: parsed.id,
                      result: { replayed: true },
                    })}\n`,
                  );
                }
              }
            });
          });
          server2.once("error", rejectListen2);
          server2.listen(endpoint, () => {
            server2?.off("error", rejectListen2);
            resolveListen2();
          });
          await listenPromise2;
          return {
            endpointPath: endpoint,
            close: async () => {
              server2?.close();
            },
          };
        },
      });

      const server1Socket = await connected1;
      let buf1 = "";
      const { promise: req1Received, resolve: resolveReq1Received } = Promise.withResolvers<void>();

      server1Socket.on("data", (chunk) => {
        buf1 += chunk.toString("utf8");
        while (true) {
          const idx = buf1.indexOf("\n");
          if (idx === -1) break;
          const line = buf1.slice(0, idx).trim();
          buf1 = buf1.slice(idx + 1);
          if (!line) continue;
          const parsed = JSON.parse(line);
          if (parsed.id === 1) {
            server1Socket.write(
              `${JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                result: { protocolVersion: "2025-11-25" },
              })}\n`,
            );
          } else if (parsed.id === 101) {
            resolveReq1Received();
          }
        }
      });

      // Initialize client first so initialize replay is configured
      clientIn.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2025-11-25" },
        })}\n`,
      );
      const initResp = JSON.parse(await readLine(clientOut));
      expect(initResp).toMatchObject({ id: 1, result: { protocolVersion: "2025-11-25" } });
      clientIn.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
      // Send first request from client
      clientIn.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: 101,
          method: "tools/call",
          params: { name: "test_tool_1", arguments: {} },
        })}\n`,
      );

      // Wait until dummy server 1 has completely received request 1 (101)
      await req1Received;

      if (dummyHostLock.acquired) dummyHostLock.release();
      server1.close();
      server1Socket.destroy();

      // Send second request from client while socket is dropped
      clientIn.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: 102,
          method: "tools/call",
          params: { name: "test_tool_2", arguments: {} },
        })}\n`,
      );

      // Read responses from clientOut
      const responses: Array<{ id: number; error?: { code: number; message: string }; result?: unknown }> = [];
      responses.push(JSON.parse(await readLine(clientOut)));
      responses.push(JSON.parse(await readLine(clientOut)));
      // Request 1 was delivered to server 1, so it gets the ambiguous -32603 restart error
      const resp101 = responses.find((r) => r.id === 101);
      expect(resp101).toBeDefined();
      expect(resp101?.error).toMatchObject({
        code: -32603,
        message: "ok-fine host restarted; retry the request",
      });

      // Request 2 was unsent / write-errored, so it was NOT answered with -32603, but replayed to server 2
      const resp102 = responses.find((r) => r.id === 102);
      expect(resp102).toBeDefined();
      expect(resp102?.error).toBeUndefined();
      expect(resp102?.result).toEqual({ replayed: true });

      // Exactly one response per id
      expect(responses).toHaveLength(2);
    } finally {
      clientIn.end();
      if (proxy) await proxy.close();
      server1.close();
      server2?.close();
      if (dummyHostLock.acquired) dummyHostLock.release();
    }
  });

  it("hello identity reaches the principal for actor validation", async () => {
    const config = loadStorageConfig({ DATA_DIR: dataDir, LOG_LEVEL: "silent" });

    const inAlice = new PassThrough();
    const outAlice = new PassThrough();
    const proxyAlice = await startStdioProxy({
      config,
      identity: "alice@example.com",
      log: silent,
      stdin: inAlice,
      stdout: outAlice,
      startHost: () => startLocalHost(config, { log: silent }),
    });
    const clientAlice = new Client({ name: "alice-client", version: "1.0.0" });
    await clientAlice.connect(new StdioServerTransport(outAlice, inAlice));

    // Alice creates project with matching identity
    const createdByAlice = await clientAlice.callTool({
      name: "create_project",
      arguments: {
        project: "alice-proj",
        title: "Alice Project",
        actor: "human:alice@example.com",
      },
    });
    expect(createdByAlice.isError).toBeFalsy();

    // Alice creates project with forged identity -> fails with forbidden_actor
    const forgedByAlice = await clientAlice.callTool({
      name: "create_project",
      arguments: {
        project: "forged-proj",
        title: "Forged Project",
        actor: "human:mallory@example.com",
      },
    });
    expect(forgedByAlice.isError).toBe(true);
    const content = forgedByAlice.content;
    const firstItem = Array.isArray(content) ? content[0] : null;
    const text =
      firstItem && typeof firstItem === "object" && "text" in firstItem && typeof firstItem.text === "string"
        ? firstItem.text
        : "";
    expect(text).toContain("forbidden_actor");
    expect(text).toContain("alice@example.com");

    inAlice.end();
    await proxyAlice.done;
    await proxyAlice.close();
  });

  it("stdio proxy connects to ok-fine serve running with hostEndpoint: true", async () => {
    const serverConfig = loadConfig({
      DATA_DIR: dataDir,
      LOG_LEVEL: "silent",
      PORT: "0",
      HOST: "127.0.0.1",
      PUBLIC_BASE_URL: "http://127.0.0.1:0",
      AUTH_MODE: "none",
    });

    const release = await lockDataDir(dataDir);
    try {
      const runningHttpServer = await startServer(serverConfig, { hostEndpoint: true });

      // Connect stdio proxy to the data dir being served by HTTP server
      const clientIn = new PassThrough();
      const clientOut = new PassThrough();
      const proxy = await startStdioProxy({
        config: loadStorageConfig({ DATA_DIR: dataDir, LOG_LEVEL: "silent" }),
        identity: "dev@example.com",
        log: silent,
        stdin: clientIn,
        stdout: clientOut,
        startHost: () => startLocalHost(loadStorageConfig({ DATA_DIR: dataDir, LOG_LEVEL: "silent" }), { log: silent }),
      });

      const client = new Client({ name: "client-via-serve", version: "1.0.0" });
      await client.connect(new StdioServerTransport(clientOut, clientIn));

      const listRes = await client.callTool({ name: "list_projects", arguments: {} });
      expect(listRes.isError).toBeFalsy();

      clientIn.end();
      await proxy.done;
      await proxy.close();
      await runningHttpServer.close();
    } finally {
      release();
    }
  });

  it("host with a connected client socket closes promptly and cleans up socket file", async () => {
    const config = loadStorageConfig({ DATA_DIR: dataDir, LOG_LEVEL: "silent" });
    const host = await startLocalHost(config, { log: silent });
    const client = net.createConnection(host.endpointPath);
    await new Promise<void>((resolve) => client.once("connect", () => resolve()));

    const closeStart = Date.now();
    await host.close();
    expect(Date.now() - closeStart).toBeLessThan(2000);

    // After host closed, a new host can start and acquire the endpoint
    const newHost = await startLocalHost(config, { log: silent });
    await newHost.close();
  });

  it("startServer refuses hostEndpoint: true when AUTH_MODE is oidc", async () => {
    const oidcConfig = loadConfig({
      DATA_DIR: dataDir,
      LOG_LEVEL: "silent",
      PORT: "0",
      HOST: "127.0.0.1",
      PUBLIC_BASE_URL: "http://127.0.0.1:0",
      AUTH_MODE: "oidc",
      OAUTH_ISSUER: "https://issuer.example.com",
    });
    await expect(startServer(oidcConfig, { hostEndpoint: true })).rejects.toThrow(
      "Cannot enable hostEndpoint with auth mode oidc",
    );
  });

  it("failover retries and recovers if first failover socket drops during initialize replay", async () => {
    const config = loadStorageConfig({ DATA_DIR: dataDir, LOG_LEVEL: "silent" });

    // Host session
    const in1 = new PassThrough();
    const out1 = new PassThrough();
    const proxy1 = await startStdioProxy({
      config,
      identity: "host@example.com",
      log: silent,
      stdin: in1,
      stdout: out1,
      startHost: () => startLocalHost(config, { log: silent }),
    });
    const client1 = new Client({ name: "client1", version: "1.0.0" });
    await client1.connect(new StdioServerTransport(out1, in1));

    // Follower session with custom startHost that drops the socket on the first attempt during replay
    let startHostAttempts = 0;
    const in2 = new PassThrough();
    const out2 = new PassThrough();
    const proxy2 = await startStdioProxy({
      config,
      identity: "follower@example.com",
      log: silent,
      stdin: in2,
      stdout: out2,
      electionTimeoutMs: 5000,
      startHost: async () => {
        startHostAttempts++;
        if (startHostAttempts === 1) {
          // First failover attempt starts a host whose socket immediately drops during replay
          const endpoint = localEndpointPath(config.dataDir);
          const rawServer = net.createServer((socket) => {
            let buf = "";
            socket.on("data", (chunk) => {
              buf += chunk.toString("utf8");
              // Once initialize replay is received, destroy socket without answering
              if (buf.includes('"initialize"')) {
                socket.destroy();
                rawServer.close();
              }
            });
          });
          await new Promise<void>((resolve) => rawServer.listen(endpoint, () => resolve()));
          return {
            endpointPath: endpoint,
            close: async () => {
              rawServer.close();
            },
          };
        }
        // Second attempt starts normal host
        return await startLocalHost(config, { log: silent });
      },
    });
    const client2 = new Client({ name: "client2", version: "1.0.0" });
    await client2.connect(new StdioServerTransport(out2, in2));

    // Verify client 2 works before failover
    const pre = await client2.callTool({ name: "list_projects", arguments: {} });
    expect(pre.isError).toBeFalsy();

    // Kill host 1
    in1.end();
    await proxy1.done;
    await proxy1.close();

    // Client 2 executes callTool; failover will hit attempt 1 (drops on replay), then retry and succeed on attempt 2
    const post = await client2.callTool({ name: "list_projects", arguments: {} });
    expect(post.isError).toBeFalsy();
    expect(startHostAttempts).toBe(2);

    in2.end();
    await proxy2.done;
    await proxy2.close();
  });

  it("gives up after electionTimeoutMs when a live process holds the lock but never serves the socket", async () => {
    // The parent process is alive and is not an ok-fine host, so no socket ever appears.
    await writeFile(join(dataDir, "ok-fine.lock"), `${process.ppid}\n`);
    let hostStarts = 0;
    const started = Date.now();
    await expect(
      startStdioProxy({
        config: loadStorageConfig({ DATA_DIR: dataDir, LOG_LEVEL: "silent" }),
        identity: null,
        log: silent,
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        electionTimeoutMs: 300,
        startHost: async () => {
          hostStarts++;
          throw new Error("must not host while the lock is held");
        },
      }),
    ).rejects.toThrow(Error);
    expect(Date.now() - started).toBeGreaterThanOrEqual(300);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(hostStarts).toBe(0);
  });
});
