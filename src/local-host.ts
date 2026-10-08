import { createHash } from "node:crypto";
import { chmod, rm } from "node:fs/promises";
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

  const server = net.createServer((socket) => {
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
  });

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

  let closing: Promise<void> | undefined;
  return {
    endpointPath,
    close: () => {
      closing ??= (async () => {
        const { promise: closePromise, resolve: resolveClose } = Promise.withResolvers<void>();
        try {
          server.close(() => resolveClose());
        } catch {
          resolveClose();
        }
        const closePromises: Promise<void>[] = [];
        for (const conn of connections) {
          if (conn.handle) {
            closePromises.push(conn.handle.close().catch(() => {}));
          }
          conn.socket.destroy();
        }
        connections.clear();
        await Promise.all(closePromises);
        await closePromise;
        if (process.platform !== "win32") {
          try {
            await rm(endpointPath, { force: true });
          } catch {
            // ignore
          }
        }
      })();
      return closing;
    },
  };
}
