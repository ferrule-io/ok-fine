import { link, lstat, mkdtemp, rename, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Logger, StorageConfig } from "./config.js";
import { loadStorageConfig } from "./config.js";
import { createLocalHost, localEndpointPath } from "./local-host.js";
import { KnowledgeService } from "./service/knowledge-service.js";
import { Catalog } from "./store/catalog.js";
import { GitBackend } from "./store/git-backend.js";

const silent: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

function connectToSocket(path: string): Promise<net.Socket> {
  const { promise, resolve, reject } = Promise.withResolvers<net.Socket>();
  const socket = net.createConnection(path);
  socket.once("connect", () => resolve(socket));
  socket.once("error", reject);
  return promise;
}

async function waitForConnect(path: string, timeoutMs = 5000): Promise<net.Socket> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return await connectToSocket(path);
    } catch {
      // Integration test deliberately polling for real watchdog socket rebind across process event loop ticks
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 20);
      await promise;
    }
  }
  throw new Error(`timed out waiting to connect to ${path}`);
}

function closeServer(server: net.Server): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  server.close(() => resolve());
  return promise;
}

function listenServer(server: net.Server, path: string): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  server.once("error", reject);
  server.listen(path, () => resolve());
  return promise;
}

function readOneChunk(socket: net.Socket): Promise<string> {
  const { promise, resolve } = Promise.withResolvers<string>();
  socket.once("data", (chunk) => resolve(chunk.toString("utf8")));
  return promise;
}

async function createTestService(config: StorageConfig) {
  const storage = await GitBackend.open(config, silent);
  const catalog = new Catalog();
  const service = new KnowledgeService({ config, storage, catalog, log: silent });
  await service.initialize();
  return {
    service,
    close: () => storage.close(),
  };
}

describe("local host socket safety", () => {
  let dataDir: string;
  let cleanups: (() => Promise<void> | void)[];

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "okf-"));
    cleanups = [];
  });

  afterEach(async () => {
    while (cleanups.length > 0) {
      const fn = cleanups.pop();
      try {
        await fn?.();
      } catch {
        // ignore
      }
    }
    await rm(dataDir, { recursive: true, force: true });
  });

  it("starting a second createLocalHost on the same data dir rejects and leaves first host listening", async () => {
    if (process.platform === "win32") return;
    const config = loadStorageConfig({ DATA_DIR: dataDir, LOG_LEVEL: "silent" });
    const svc = await createTestService(config);
    cleanups.push(() => svc.close());

    const host1 = await createLocalHost({ service: svc.service, config, log: silent });
    cleanups.push(() => host1.close());

    await expect(createLocalHost({ service: svc.service, config, log: silent })).rejects.toThrow(
      `another ok-fine host is already listening on ${host1.endpointPath}`,
    );

    const socket = await connectToSocket(host1.endpointPath);
    socket.destroy();
  });

  it("replaces a stale socket file and starts successfully", async () => {
    if (process.platform === "win32") return;
    const config = loadStorageConfig({ DATA_DIR: dataDir, LOG_LEVEL: "silent" });
    const svc = await createTestService(config);
    cleanups.push(() => svc.close());

    const endpointPath = localEndpointPath(config.dataDir);

    const staleServer = net.createServer();
    await listenServer(staleServer, endpointPath);
    const staleBak = `${endpointPath}.stale`;
    await link(endpointPath, staleBak);
    await closeServer(staleServer);
    await rename(staleBak, endpointPath);
    const sBefore = await lstat(endpointPath);
    expect(sBefore.isSocket()).toBe(true);

    const host = await createLocalHost({ service: svc.service, config, log: silent });
    cleanups.push(() => host.close());

    const socket = await connectToSocket(host.endpointPath);
    socket.destroy();
  });

  it("close() does not unlink a path that now belongs to a different socket", async () => {
    if (process.platform === "win32") return;
    const config = loadStorageConfig({ DATA_DIR: dataDir, LOG_LEVEL: "silent" });
    const svc = await createTestService(config);
    cleanups.push(() => svc.close());

    const host = await createLocalHost({
      service: svc.service,
      config,
      log: silent,
      watchdogIntervalMs: 60_000,
    });

    const endpointPath = host.endpointPath;

    await rm(endpointPath);

    const replacementServer = net.createServer((sock) => {
      sock.write("hello from replacement");
      sock.end();
    });
    cleanups.push(async () => {
      await closeServer(replacementServer);
      await rm(endpointPath, { force: true });
    });
    await listenServer(replacementServer, endpointPath);

    await host.close();

    const sAfter = await lstat(endpointPath);
    expect(sAfter.isSocket()).toBe(true);

    const socket = await connectToSocket(endpointPath);
    const data = await readOneChunk(socket);
    socket.destroy();
    expect(data).toBe("hello from replacement");
  });

  it("rebinds when the socket path is removed", async () => {
    if (process.platform === "win32") return;
    const config = loadStorageConfig({ DATA_DIR: dataDir, LOG_LEVEL: "silent" });
    const svc = await createTestService(config);
    cleanups.push(() => svc.close());

    const host = await createLocalHost({
      service: svc.service,
      config,
      log: silent,
      watchdogIntervalMs: 50,
    });
    cleanups.push(() => host.close());

    const endpointPath = host.endpointPath;
    const initialSocket = await connectToSocket(endpointPath);
    initialSocket.destroy();

    await rm(endpointPath);

    const reconnectedSocket = await waitForConnect(endpointPath, 4000);
    reconnectedSocket.destroy();

    const s = await lstat(endpointPath);
    expect(s.isSocket()).toBe(true);
  });

  it("keeps old servers open across rebind so existing connections survive", async () => {
    if (process.platform === "win32") return;
    const config = loadStorageConfig({ DATA_DIR: dataDir, LOG_LEVEL: "silent" });
    const svc = await createTestService(config);
    cleanups.push(() => svc.close());

    const host = await createLocalHost({
      service: svc.service,
      config,
      log: silent,
      watchdogIntervalMs: 50,
    });
    cleanups.push(() => host.close());

    const endpointPath = host.endpointPath;

    const existingSocket = await connectToSocket(endpointPath);
    cleanups.push(async () => {
      existingSocket.destroy();
    });

    await rm(endpointPath);

    const newSocket = await waitForConnect(endpointPath, 4000);
    cleanups.push(async () => {
      newSocket.destroy();
    });

    expect(existingSocket.destroyed).toBe(false);
    expect(newSocket.destroyed).toBe(false);
    // Both connections write hello successfully without error
    existingSocket.write(`${JSON.stringify({ okFine: 1, identity: "existing@example.com" })}\n`);
    newSocket.write(`${JSON.stringify({ okFine: 1, identity: "new@example.com" })}\n`);

    expect(existingSocket.destroyed).toBe(false);
    expect(newSocket.destroyed).toBe(false);
  });

  it("does not touch path with different inode and warns once", async () => {
    if (process.platform === "win32") return;
    const config = loadStorageConfig({ DATA_DIR: dataDir, LOG_LEVEL: "silent" });
    const svc = await createTestService(config);
    cleanups.push(() => svc.close());

    const warnCalls: unknown[] = [];
    const { promise: warnPromise, resolve: resolveWarn } = Promise.withResolvers<void>();
    const testLogger: Logger = {
      ...silent,
      warn: (objOrMsg, msg) => {
        warnCalls.push({ objOrMsg, msg });
        resolveWarn();
      },
    };
    const host = await createLocalHost({
      service: svc.service,
      config,
      log: testLogger,
      watchdogIntervalMs: 50,
    });
    cleanups.push(() => host.close());

    const endpointPath = host.endpointPath;
    await rm(endpointPath);

    const replacementServer = net.createServer();
    cleanups.push(async () => {
      await closeServer(replacementServer);
      await rm(endpointPath, { force: true });
    });
    await listenServer(replacementServer, endpointPath);

    // Await the warning signal emitted when watchdog detects the replacement inode
    await warnPromise;

    const statReplacement = await lstat(endpointPath);
    expect(statReplacement.isSocket()).toBe(true);

    const takeoverWarnings = warnCalls.filter((c) => {
      const entry = c as { objOrMsg: unknown; msg?: string };
      return typeof entry.msg === "string" && entry.msg.includes("replaced");
    });
    expect(takeoverWarnings).toHaveLength(1);
  });
});
