import { createHash } from "node:crypto";
import { chmod, link, lstat, rename, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PassThrough } from "node:stream";
import { StdioServerTransport, serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import type { Logger, StorageConfig } from "./config.js";
import { createMcpServer } from "./mcp/server.js";
import type { KnowledgeService } from "./service/knowledge-service.js";
import type { Principal } from "./service/principal.js";

const HelloMessageSchema = z.object({
  okFine: z.literal(1),
  identity: z.string().nullable(),
});

/**
 * Resolves the local IPC endpoint path for a given data directory:
 * - Windows: named pipe `\\.\pipe\ok-fine-<first 16 hex of sha256(resolved dataDir)>`
 * - Unix: `DATA_DIR/ok-fine.sock` (or `os.tmpdir()/ok-fine-<hash>.sock` if default exceeds 100 bytes)
 */
export function localEndpointPath(dataDir: string): string {
  const resolvedDir = resolve(dataDir);
  const hash = createHash("sha256").update(resolvedDir).digest("hex").slice(0, 16);
  if (process.platform === "win32") {
    return `\\\\.\\pipe\\ok-fine-${hash}`;
  }
  const defaultPath = join(resolvedDir, "ok-fine.sock");
  if (Buffer.byteLength(defaultPath) > 100) {
    return join(tmpdir(), `ok-fine-${hash}.sock`);
  }
  return defaultPath;
}

export interface RunningLocalHost {
  endpointPath: string;
  close(): Promise<void>;
}

export interface CreateLocalHostOptions {
  service: KnowledgeService;
  config: StorageConfig;
  log: Logger;
  watchdogIntervalMs?: number;
}

function probeEndpoint(endpointPath: string): Promise<"listening" | "stale_or_missing"> {
  const { promise, resolve, reject } = Promise.withResolvers<"listening" | "stale_or_missing">();
  const socket = new net.Socket();
  let settled = false;

  const timer = setTimeout(() => {
    finish(() => {
      reject(new Error(`timed out probing ${endpointPath}`));
    });
  }, 2000);
  timer.unref();

  const finish = (action: () => void) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    socket.removeAllListeners();
    socket.on("error", () => {});
    socket.destroy();
    action();
  };

  socket.once("connect", () => {
    finish(() => resolve("listening"));
  });

  socket.once("error", (err: NodeJS.ErrnoException) => {
    finish(() => {
      if (
        err.code === "ECONNREFUSED" ||
        err.code === "ENOENT" ||
        err.code === "ECONNRESET" ||
        err.code === "ECONNABORTED"
      ) {
        resolve("stale_or_missing");
      } else {
        reject(err);
      }
    });
  });

  socket.connect(endpointPath);
  return promise;
}

/**
 * Starts the local endpoint listener on Unix domain socket or Windows named pipe.
 * Each incoming connection sends a newline-delimited JSON hello with its identity,
 * and receives its own MCP server instance with full local permissions.
 */
export async function createLocalHost(options: CreateLocalHostOptions): Promise<RunningLocalHost> {
  const { service, config, log } = options;
  const endpointPath = localEndpointPath(config.dataDir);

  if (process.platform !== "win32") {
    const probe = await probeEndpoint(endpointPath);
    if (probe === "listening") {
      throw new Error(`another ok-fine host is already listening on ${endpointPath}`);
    }
    try {
      await rm(endpointPath, { force: true });
    } catch {
      // safe: we hold the data dir lock
    }
  }

  const connections = new Set<{
    socket: net.Socket;
    handle?: { close(): Promise<void> };
  }>();

  const handleConnection = (socket: net.Socket) => {
    socket.on("error", (err) => log.debug({ err }, "local host client socket error"));

    const connRecord: {
      socket: net.Socket;
      handle?: { close(): Promise<void> };
    } = { socket };
    connections.add(connRecord);

    const cleanup = () => {
      connections.delete(connRecord);
    };
    socket.once("close", cleanup);
    socket.once("end", cleanup);

    let buffer = "";
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const idx = buffer.indexOf("\n");
      if (idx === -1) {
        if (buffer.length > 65536) {
          socket.destroy();
        }
        return;
      }

      socket.off("data", onData);
      const firstLine = buffer.slice(0, idx).trim();
      const remainder = buffer.slice(idx + 1);

      let helloRaw: unknown;
      try {
        helloRaw = JSON.parse(firstLine);
      } catch {
        socket.destroy();
        return;
      }

      const parsed = HelloMessageSchema.safeParse(helloRaw);
      if (!parsed.success) {
        socket.destroy();
        return;
      }

      const identity = parsed.data.identity;
      const principal: Principal = {
        subject: "local",
        clientId: "stdio",
        identity,
        groups: [],
        scopes: [],
        canRead: true,
        canWrite: true,
        canAdmin: true,
      };

      const inStream = new PassThrough();
      inStream.on("error", (err) => log.debug({ err }, "client inStream error"));

      if (remainder.length > 0) {
        inStream.write(Buffer.from(remainder, "utf8"));
      }
      socket.pipe(inStream);

      const handle = serveStdio(() => createMcpServer(service, principal, log), {
        transport: new StdioServerTransport(inStream, socket),
        onerror: (err) => log.error({ err }, "local host stdio transport error"),
      });
      connRecord.handle = handle;
    };

    socket.on("data", onData);
  };
  const servers = new Set<net.Server>();

  const server = net.createServer(handleConnection);
  server.on("error", (err) => log.debug({ err }, "local host server error"));

  const { promise: listenPromise, resolve: resolveListen, reject: rejectListen } = Promise.withResolvers<void>();
  server.once("error", rejectListen);
  server.listen(endpointPath, () => {
    server.off("error", rejectListen);
    resolveListen();
  });
  await listenPromise;

  if (process.platform !== "win32") {
    try {
      await chmod(endpointPath, 0o600);
    } catch {
      // safe ignore
    }
  }

  servers.add(server);
  server.on("close", () => {
    servers.delete(server);
  });

  let currentIdentity: { dev: number; ino: number } | undefined;
  if (process.platform !== "win32") {
    try {
      const s = await lstat(endpointPath);
      currentIdentity = { dev: s.dev, ino: s.ino };
    } catch (err) {
      log.warn({ err }, "failed to stat local host endpoint");
    }
  }

  let closed = false;
  let warnedDifferentIno = false;
  let checkInFlight = false;
  let inFlightPromise: Promise<void> | undefined;

  const rebind = async (): Promise<void> => {
    if (closed) return;
    const newServer = net.createServer(handleConnection);
    newServer.on("error", (err) => log.debug({ err }, "local host re-bound server error"));

    const {
      promise: rebindListenPromise,
      resolve: resolveRebindListen,
      reject: rejectRebindListen,
    } = Promise.withResolvers<void>();
    newServer.once("error", rejectRebindListen);
    newServer.listen(endpointPath, () => {
      newServer.off("error", rejectRebindListen);
      resolveRebindListen();
    });

    try {
      await rebindListenPromise;
    } catch (err) {
      log.warn({ err, endpointPath }, "failed to rebind local host endpoint");
      try {
        newServer.close();
      } catch {
        // ignore
      }
      return;
    }

    if (closed) {
      try {
        newServer.close();
      } catch {
        // ignore
      }
      return;
    }

    servers.add(newServer);
    newServer.on("close", () => {
      servers.delete(newServer);
    });

    try {
      await chmod(endpointPath, 0o600);
    } catch {
      // safe ignore
    }

    try {
      const s = await lstat(endpointPath);
      currentIdentity = { dev: s.dev, ino: s.ino };
      warnedDifferentIno = false;
    } catch (err) {
      log.warn({ err }, "failed to stat re-bound local host endpoint");
    }

    log.warn({ endpointPath }, "re-bound local host endpoint after missing socket file");
  };

  const checkEndpoint = async (): Promise<void> => {
    if (closed) return;
    try {
      const s = await lstat(endpointPath);
      if (!currentIdentity) {
        currentIdentity = { dev: s.dev, ino: s.ino };
      } else if (s.dev !== currentIdentity.dev || s.ino !== currentIdentity.ino) {
        if (!warnedDifferentIno) {
          warnedDifferentIno = true;
          log.warn(
            { endpointPath, expected: currentIdentity, actual: { dev: s.dev, ino: s.ino } },
            `another ok-fine host or process replaced ${endpointPath}`,
          );
        }
      } else {
        warnedDifferentIno = false;
      }
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        if (closed) return;
        await rebind();
      } else {
        log.debug({ err }, "local host watchdog stat error");
      }
    }
  };

  const runCheck = async (): Promise<void> => {
    if (closed || checkInFlight) return;
    checkInFlight = true;
    const p = checkEndpoint();
    inFlightPromise = p;
    try {
      await p;
    } catch (err) {
      log.warn({ err }, "local host watchdog check failed");
    } finally {
      checkInFlight = false;
      if (inFlightPromise === p) {
        inFlightPromise = undefined;
      }
    }
  };

  let watchdogTimer: NodeJS.Timeout | undefined;
  if (process.platform !== "win32") {
    const intervalMs = options.watchdogIntervalMs ?? 2000;
    if (intervalMs > 0) {
      watchdogTimer = setInterval(() => {
        void runCheck();
      }, intervalMs);
      watchdogTimer.unref();
    }
  }

  let closing: Promise<void> | undefined;
  return {
    endpointPath,
    close: () => {
      closing ??= (async () => {
        closed = true;
        if (watchdogTimer) {
          clearInterval(watchdogTimer);
          watchdogTimer = undefined;
        }
        if (inFlightPromise) {
          try {
            await inFlightPromise;
          } catch {
            // ignore
          }
        }
        let preservedReplacementPath: string | undefined;
        if (process.platform !== "win32" && currentIdentity) {
          try {
            const s = await lstat(endpointPath);
            if (s.dev !== currentIdentity.dev || s.ino !== currentIdentity.ino) {
              const tmpBak = `${endpointPath}.preserve-${Date.now()}-${Math.random().toString(36).slice(2)}`;
              try {
                await link(endpointPath, tmpBak);
                preservedReplacementPath = tmpBak;
              } catch {
                try {
                  await rename(endpointPath, tmpBak);
                  preservedReplacementPath = tmpBak;
                } catch {
                  // ignore
                }
              }
            }
          } catch {
            // ignore
          }
        }

        const serverClosePromises = Array.from(servers).map((s) => {
          const { promise: p, resolve: res } = Promise.withResolvers<void>();
          try {
            s.close(() => res());
          } catch {
            res();
          }
          return p;
        });
        servers.clear();

        const closePromises: Promise<void>[] = [];
        for (const conn of connections) {
          if (conn.handle) {
            closePromises.push(conn.handle.close().catch(() => {}));
          }
          conn.socket.destroy();
        }
        connections.clear();

        await Promise.all(closePromises);
        await Promise.all(serverClosePromises);
        if (preservedReplacementPath) {
          try {
            await rename(preservedReplacementPath, endpointPath);
          } catch {
            // ignore
          }
        } else if (process.platform !== "win32" && currentIdentity) {
          try {
            const s = await lstat(endpointPath);
            if (s.dev === currentIdentity.dev && s.ino === currentIdentity.ino) {
              await rm(endpointPath, { force: true });
            }
          } catch (err: unknown) {
            const code = (err as NodeJS.ErrnoException).code;
            if (code !== "ENOENT") {
              log.debug({ err }, "failed to stat endpoint on close");
            }
          }
        }
      })();
      return closing;
    },
  };
}
