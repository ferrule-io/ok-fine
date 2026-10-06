import net from "node:net";
import type { Readable, Writable } from "node:stream";
import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import type { Logger, StorageConfig } from "./config.js";
import { isProcessAlive, tryLockDataDir } from "./data-dir-lock.js";
import { localEndpointPath, type RunningLocalHost } from "./local-host.js";

const JsonRpcMessageSchema = z
  .object({
    jsonrpc: z.string().optional(),
    id: z.union([z.string(), z.number()]).optional(),
    method: z.string().optional(),
    params: z.unknown().optional(),
    result: z.unknown().optional(),
    error: z.unknown().optional(),
  })
  .passthrough();

export interface StdioProxyOptions {
  config: StorageConfig;
  identity: string | null;
  log: Logger;
  /** Function to start the local endpoint host if elected. */
  startHost: () => Promise<RunningLocalHost>;
  /** Defaults to process.stdin. */
  stdin?: Readable;
  /** Defaults to process.stdout. */
  stdout?: Writable;
  /** Election timeout in ms (default 30,000). */
  electionTimeoutMs?: number;
}

export interface RunningStdioProxy {
  /** Resolves when client stdin ends or close() finishes. */
  done: Promise<void>;
  close(): Promise<void>;
}

function tryConnectSocket(endpoint: string): Promise<net.Socket | null> {
  const { promise, resolve } = Promise.withResolvers<net.Socket | null>();
  const socket = net.createConnection(endpoint);
  const onError = () => {
    socket.destroy();
    resolve(null);
  };
  socket.once("error", onError);
  socket.once("connect", () => {
    socket.off("error", onError);
    resolve(socket);
  });
  return promise;
}

async function connectSocket(endpoint: string, timeoutMs: number): Promise<net.Socket> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const socket = await tryConnectSocket(endpoint);
    if (socket) return socket;
    await sleep(25);
  }
  throw new Error(`Failed to connect to local endpoint at ${endpoint}`);
}

/**
 * Starts a stdio proxy session. Every stdio CLI process is a proxy:
 * runs election to start the local endpoint host if it acquires the lock,
 * or attaches to an existing host.
 */
export async function startStdioProxy(options: StdioProxyOptions): Promise<RunningStdioProxy> {
  const { config, identity, log, startHost } = options;
  const stdin = options.stdin ?? process.stdin;
  const stdout = options.stdout ?? process.stdout;
  const timeoutMs = options.electionTimeoutMs ?? 30_000;
  const endpoint = localEndpointPath(config.dataDir);

  const { promise: done, resolve: resolveDone } = Promise.withResolvers<void>();

  let shuttingDown = false;
  let isFailingOver = false;
  let isReconnecting = false;
  let activeSocket: net.Socket | null = null;
  let activeHost: RunningLocalHost | null = null;
  let activeLockRelease: (() => void) | null = null;

  /** Drops the current socket and, if this process hosts, closes the host and releases the lock. */
  async function teardownActive(): Promise<void> {
    const socket = activeSocket;
    activeSocket = null;
    if (socket) {
      socket.removeAllListeners();
      socket.destroy();
    }
    const host = activeHost;
    activeHost = null;
    if (host) await host.close().catch((err: unknown) => log.error({ err }, "closing local host failed"));
    const release = activeLockRelease;
    activeLockRelease = null;
    release?.();
  }
  let storedInitialize: { raw: string; parsed: Record<string, unknown> } | null = null;
  let storedInitialized: string | null = null;
  const inFlightRequests = new Map<string | number, string | number>();
  const pendingStdinLines: string[] = [];

  let replaySeq = 0;
  let awaitingReplayId: string | null = null;
  let onReplayResponse: (() => void) | null = null;

  async function runElection(deadline: number): Promise<net.Socket> {
    while (Date.now() < deadline && !shuttingDown) {
      const lockRes = await tryLockDataDir(config.dataDir);
      if (lockRes.acquired) {
        activeLockRelease = lockRes.release;
        try {
          activeHost = await startHost();
          const remainingMs = Math.min(5000, Math.max(100, deadline - Date.now()));
          return await connectSocket(endpoint, remainingMs);
        } catch (err) {
          if (activeHost) {
            await activeHost.close().catch(() => {});
            activeHost = null;
          }
          activeLockRelease();
          activeLockRelease = null;
          throw err;
        }
      }

      const holderPid = lockRes.holderPid;
      if (holderPid !== null && isProcessAlive(holderPid)) {
        const socket = await tryConnectSocket(endpoint);
        if (socket) return socket;
      }
      await sleep(50);
    }
    const timeoutStr = timeoutMs % 1000 === 0 ? `${timeoutMs / 1000}s` : `${timeoutMs}ms`;
    throw new Error(`Timed out waiting for ok-fine host on ${config.dataDir} after ${timeoutStr}`);
  }

  function handleStdinLine(line: string): void {
    let msg: z.infer<typeof JsonRpcMessageSchema> | null = null;
    try {
      const parsed = JsonRpcMessageSchema.safeParse(JSON.parse(line));
      if (parsed.success) msg = parsed.data;
    } catch {
      // Non-JSON line, forward as-is
    }

    if (msg) {
      if (msg.method === "initialize" && msg.id !== undefined) {
        storedInitialize = { raw: line, parsed: msg as Record<string, unknown> };
      } else if (msg.method === "notifications/initialized") {
        storedInitialized = line;
      }
      if (msg.id !== undefined && msg.method !== undefined) {
        inFlightRequests.set(msg.id, msg.id);
      }
    }

    if (isReconnecting || !activeSocket || activeSocket.destroyed || !activeSocket.writable) {
      pendingStdinLines.push(line);
    } else {
      activeSocket.write(`${line}\n`);
    }
  }

  let stdinBuffer = "";
  function onStdinData(chunk: Buffer | string): void {
    stdinBuffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    while (true) {
      const idx = stdinBuffer.indexOf("\n");
      if (idx === -1) break;
      const line = stdinBuffer.slice(0, idx).replace(/\r$/, "");
      stdinBuffer = stdinBuffer.slice(idx + 1);
      if (line.length > 0) {
        handleStdinLine(line);
      }
    }
  }

  function handleSocketLine(line: string): void {
    let msg: z.infer<typeof JsonRpcMessageSchema> | null = null;
    try {
      const parsed = JsonRpcMessageSchema.safeParse(JSON.parse(line));
      if (parsed.success) msg = parsed.data;
    } catch {
      // Non-JSON line
    }

    if (msg && awaitingReplayId !== null && msg.id === awaitingReplayId) {
      const resolve = onReplayResponse;
      awaitingReplayId = null;
      onReplayResponse = null;
      resolve?.();
      return;
    }

    if (msg && msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
      inFlightRequests.delete(msg.id);
    }

    stdout.write(`${line}\n`);
  }

  let socketBuffer = "";
  function onSocketData(chunk: Buffer | string): void {
    socketBuffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    while (true) {
      const idx = socketBuffer.indexOf("\n");
      if (idx === -1) break;
      const line = socketBuffer.slice(0, idx).replace(/\r$/, "");
      socketBuffer = socketBuffer.slice(idx + 1);
      if (line.length > 0) {
        handleSocketLine(line);
      }
    }
  }

  async function handleSocketClose(): Promise<void> {
    if (shuttingDown || isFailingOver) return;
    isFailingOver = true;
    isReconnecting = true;

    try {
      await teardownActive();

      // Answer every in-flight request with host restart error
      for (const id of inFlightRequests.values()) {
        const errorResponse = {
          jsonrpc: "2.0",
          id,
          error: {
            code: -32603,
            message: "ok-fine host restarted; retry the request",
          },
        };
        stdout.write(`${JSON.stringify(errorResponse)}\n`);
      }
      inFlightRequests.clear();

      const deadline = Date.now() + timeoutMs;
      let connectedSocket: net.Socket | null = null;

      while (Date.now() < deadline && !shuttingDown) {
        try {
          const socket = await runElection(deadline);
          attachSocket(socket);
          socket.write(`${JSON.stringify({ okFine: 1, identity })}\n`);

          if (storedInitialize) {
            const replayId = `okf-replay-${++replaySeq}`;
            awaitingReplayId = replayId;

            const remainingMs = Math.max(1, deadline - Date.now());
            const replayTimeoutMs = Math.min(timeoutMs, remainingMs);

            const {
              promise: replayPromise,
              resolve: resolveReplay,
              reject: rejectReplay,
            } = Promise.withResolvers<void>();
            onReplayResponse = resolveReplay;

            const onEarlyClose = () => {
              rejectReplay(new Error("Socket closed while awaiting initialize replay response"));
            };
            const onEarlyError = (err: Error) => {
              rejectReplay(err);
            };

            const timer = setTimeout(() => {
              const timeoutStr = replayTimeoutMs % 1000 === 0 ? `${replayTimeoutMs / 1000}s` : `${replayTimeoutMs}ms`;
              rejectReplay(new Error(`Timed out awaiting initialize replay response after ${timeoutStr}`));
            }, replayTimeoutMs);

            socket.once("close", onEarlyClose);
            socket.once("error", onEarlyError);

            try {
              const replayReq = { ...storedInitialize.parsed, id: replayId };
              socket.write(`${JSON.stringify(replayReq)}\n`);
              await replayPromise;

              if (storedInitialized) {
                socket.write(`${storedInitialized}\n`);
              } else {
                socket.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
              }
            } finally {
              clearTimeout(timer);
              socket.off("close", onEarlyClose);
              socket.off("error", onEarlyError);
              if (awaitingReplayId === replayId) {
                awaitingReplayId = null;
                onReplayResponse = null;
              }
            }
          }

          connectedSocket = socket;
          break;
        } catch (attemptErr) {
          log.debug({ err: attemptErr }, "failover attempt failed, retrying");
          await teardownActive();
          if (Date.now() >= deadline || shuttingDown) {
            throw attemptErr;
          }
          await sleep(50);
        }
      }

      if (!connectedSocket && !shuttingDown) {
        const timeoutStr = timeoutMs % 1000 === 0 ? `${timeoutMs / 1000}s` : `${timeoutMs}ms`;
        throw new Error(`Timed out waiting for ok-fine host on ${config.dataDir} after ${timeoutStr}`);
      }

      isReconnecting = false;
      const queued = pendingStdinLines.splice(0, pendingStdinLines.length);
      for (const q of queued) {
        connectedSocket?.write(`${q}\n`);
      }
    } catch (err) {
      log.error({ err }, "proxy failover failed");
      await shutdown();
    } finally {
      isFailingOver = false;
    }
  }

  function attachSocket(socket: net.Socket): void {
    activeSocket = socket;
    socketBuffer = "";
    socket.on("data", onSocketData);
    socket.on("error", (err) => log.debug({ err }, "proxy socket error"));
    socket.once("close", () => {
      void handleSocketClose();
    });
  }

  async function shutdown(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;

    stdin.off("data", onStdinData);

    if (activeSocket) {
      activeSocket.removeAllListeners();
      activeSocket.destroy();
      activeSocket = null;
    }

    if (activeHost) {
      try {
        await activeHost.close();
      } catch (err) {
        log.error({ err }, "error closing host on shutdown");
      }
      activeHost = null;
    }

    if (activeLockRelease) {
      try {
        activeLockRelease();
      } catch (err) {
        log.error({ err }, "error releasing lock on shutdown");
      }
      activeLockRelease = null;
    }

    resolveDone();
  }

  // Initial election and connection
  const initialSocket = await runElection(Date.now() + timeoutMs);
  attachSocket(initialSocket);
  initialSocket.write(`${JSON.stringify({ okFine: 1, identity })}\n`);

  stdin.on("data", onStdinData);
  stdin.once("end", () => {
    void shutdown();
  });
  stdin.once("close", () => {
    void shutdown();
  });

  if (stdin.readableEnded || stdin.destroyed) {
    void shutdown();
  }

  let closing: Promise<void> | undefined;
  return {
    done,
    close: () => {
      closing ??= shutdown();
      return closing;
    },
  };
}
