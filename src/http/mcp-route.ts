import type { AuthInfo } from "@modelcontextprotocol/server";
import type { FastifyInstance } from "fastify";

/** The `fetch` face of the SDK's `createMcpHandler` result. */
export type McpFetch = (request: Request, options: { authInfo?: AuthInfo; parsedBody?: unknown }) => Promise<Response>;

const DROPPED_HEADERS: Record<string, true> = {
  host: true,
  "content-length": true,
  "transfer-encoding": true,
  connection: true,
};

export function registerMcpRoute(app: FastifyInstance, mcpFetch: McpFetch, publicBaseUrl: string): void {
  app.route({
    method: ["GET", "POST", "DELETE"],
    url: "/mcp",
    config: { permission: "read" },
    handler: async (req, reply) => {
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) {
        if (value === undefined || DROPPED_HEADERS[name]) continue;
        headers.set(name, Array.isArray(value) ? value.join(", ") : value);
      }
      const request = new Request(new URL(req.url, publicBaseUrl), {
        method: req.method,
        headers,
        body: req.method === "POST" ? JSON.stringify(req.body) : undefined,
      });
      const response = await mcpFetch(request, {
        authInfo: req.authInfo ?? undefined,
        parsedBody: req.method === "POST" ? req.body : undefined,
      });
      return reply.send(response);
    },
  });
}
