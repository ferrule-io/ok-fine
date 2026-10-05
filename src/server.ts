import { setTimeout as sleep } from "node:timers/promises";
import {
  type AuthInfo,
  buildOAuthProtectedResourceMetadata,
  createMcpHandler,
  getOAuthProtectedResourceMetadataUrl,
  type OAuthMetadata,
} from "@modelcontextprotocol/server";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { type DiscoveredAuthorizationServer, discoverAuthorizationServer } from "./auth/discovery.js";
import { createAuthenticator } from "./auth/http-auth.js";
import { JwtTokenVerifier, principalFromAuthInfo } from "./auth/verifier.js";
import type { Config } from "./config.js";
import { OkfError } from "./errors.js";
import { registerMcpRoute } from "./http/mcp-route.js";
import { registerRestRoutes } from "./http/rest.js";
import { createMcpServer } from "./mcp/server.js";
import { KnowledgeService } from "./service/knowledge-service.js";
import type { Principal } from "./service/principal.js";
import { Catalog } from "./store/catalog.js";
import { GitBackend } from "./store/git-backend.js";

type Permission = "read" | "write" | "admin";

type AuthHandler =
  | {
      mode: "oidc";
      authenticate(req: FastifyRequest): Promise<Response | null>;
      insufficientScope(scopeName: string): Response;
    }
  | {
      mode: "none";
      authenticate(req: FastifyRequest): Promise<Response | null>;
    };

declare module "fastify" {
  interface FastifyRequest {
    principal: Principal | null;
    authInfo: AuthInfo | null;
  }
  interface FastifyContextConfig {
    permission?: Permission;
  }
}

export interface RunningServer {
  app: FastifyInstance;
  url: string;
  close(): Promise<void>;
}

const DISCOVERY_ATTEMPTS = 5;
const DISCOVERY_RETRY_MS = 2000;

export async function startServer(config: Config): Promise<RunningServer> {
  const app = Fastify({
    logger: { level: config.logLevel, redact: ["req.headers.authorization"] },
    trustProxy: true,
    bodyLimit: 4 * 1024 * 1024,
  });
  app.removeContentTypeParser("text/plain");
  app.addContentTypeParser(
    /^text\//,
    { parseAs: "string", bodyLimit: config.maxFileBytes + 65536 },
    (_req, body, done) => done(null, body),
  );
  app.addContentTypeParser(
    ["application/gzip", "application/x-gzip", "application/octet-stream"],
    { parseAs: "buffer", bodyLimit: config.maxArchiveBytes },
    (_req, body, done) => done(null, body),
  );

  let authHandler: AuthHandler;

  if (config.auth.mode === "oidc") {
    let discovered: DiscoveredAuthorizationServer | undefined;
    for (let attempt = 1; !discovered; attempt++) {
      try {
        discovered = await discoverAuthorizationServer(config.auth.issuer, {
          timeoutMs: 5000,
          ...(config.auth.jwksUri === undefined ? {} : { jwksUri: config.auth.jwksUri }),
        });
      } catch (err) {
        if (attempt >= DISCOVERY_ATTEMPTS) throw err;
        app.log.warn({ err, attempt }, "authorization server discovery failed; retrying");
        await sleep(DISCOVERY_RETRY_MS);
      }
    }
    const { metadata, jwksUri } = discovered;

    const resourceServerUrl = new URL(`${config.publicBaseUrl}/mcp`);
    const prm = buildOAuthProtectedResourceMetadata({
      // Discovery checked `issuer`; buildOAuthProtectedResourceMetadata validates the rest and throws on misconfiguration.
      oauthMetadata: metadata as unknown as OAuthMetadata,
      resourceServerUrl,
      scopesSupported: [config.scopeNames.read, config.scopeNames.write, config.scopeNames.admin],
      resourceName: "ok-fine",
      dangerouslyAllowInsecureIssuerUrl: config.auth.allowInsecureIssuer,
    });

    for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]) {
      app.get(path, async (_req, reply) => reply.header("access-control-allow-origin", "*").send(prm));
    }
    app.get("/.well-known/oauth-authorization-server", async (_req, reply) =>
      reply.header("access-control-allow-origin", "*").send(metadata),
    );

    const verifier = new JwtTokenVerifier({
      issuer: config.auth.issuer,
      audiences: config.auth.audiences,
      jwksUri,
      identityClaims: config.auth.identityClaims,
    });
    const authenticator = createAuthenticator({
      verifier,
      resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(resourceServerUrl),
      scopeNames: config.scopeNames,
    });

    authHandler = {
      mode: "oidc",
      authenticate: async (req) => {
        const result = await authenticator.authenticate(req.headers.authorization);
        if (!result.ok) return result.response;
        req.principal = result.principal;
        req.authInfo = result.authInfo;
        return null;
      },
      insufficientScope: (scopeName) => authenticator.insufficientScope(scopeName),
    };
  } else {
    app.log.warn("authentication disabled, every request has admin access; never expose this beyond localhost");

    const allScopes = [config.scopeNames.read, config.scopeNames.write, config.scopeNames.admin];
    const anonymousAuthInfo: AuthInfo = {
      token: "",
      clientId: "anonymous",
      scopes: allScopes,
      extra: { sub: "anonymous", identity: null },
    };
    const anonymousPrincipal = principalFromAuthInfo(anonymousAuthInfo, config.scopeNames);

    authHandler = {
      mode: "none",
      authenticate: async (req) => {
        req.principal = anonymousPrincipal;
        req.authInfo = anonymousAuthInfo;
        return null;
      },
    };
  }

  const storage = await GitBackend.open(config, app.log);
  const catalog = new Catalog();
  const service = new KnowledgeService({ config, storage, catalog, log: app.log });
  await service.initialize();
  const mcpHandler = createMcpHandler(
    ({ authInfo }) => {
      if (!authInfo) throw new Error("MCP request reached the handler without authInfo");
      return createMcpServer(service, principalFromAuthInfo(authInfo, config.scopeNames), app.log);
    },
    { legacy: "stateless", responseMode: "json" },
  );

  app.setErrorHandler((error, req, reply) => {
    if (error instanceof OkfError) {
      return reply
        .code(error.status)
        .send({ error: { code: error.code, message: error.message, details: error.details } });
    }
    if (error instanceof ZodError) {
      return reply
        .code(400)
        .send({ error: { code: "bad_request", message: "invalid request", details: error.issues } });
    }
    const fastifyError = error as { code?: string; statusCode?: number; message?: string };
    if (fastifyError.code === "FST_ERR_CTP_BODY_TOO_LARGE") {
      return reply.code(413).send({ error: { code: "payload_too_large", message: "request body too large" } });
    }
    if (fastifyError.code === "FST_ERR_CTP_INVALID_MEDIA_TYPE") {
      return reply.code(415).send({ error: { code: "unsupported_media", message: "unsupported content type" } });
    }
    const status = fastifyError.statusCode;
    if (typeof status === "number" && status >= 400 && status < 500) {
      return reply
        .code(status)
        .send({ error: { code: "bad_request", message: fastifyError.message ?? "bad request" } });
    }
    req.log.error({ err: error }, "unhandled error");
    return reply.code(500).send({ error: { code: "internal", message: "internal error" } });
  });

  app.get("/healthz", async () => ({ status: "ok" }));

  app.decorateRequest("principal", null);
  app.decorateRequest("authInfo", null);
  await app.register(async (secured) => {
    secured.addHook("preHandler", async (req, reply) => {
      const challenge = await authHandler.authenticate(req);
      if (challenge) return reply.send(challenge);
      if (authHandler.mode === "oidc") {
        const need = req.routeOptions.config.permission ?? "read";
        const p = req.principal;
        const permitted = p !== null && (need === "admin" ? p.canAdmin : need === "write" ? p.canWrite : p.canRead);
        if (!permitted) return reply.send(authHandler.insufficientScope(config.scopeNames[need]));
      }
    });
    registerMcpRoute(secured, (request, options) => mcpHandler.fetch(request, options), config.publicBaseUrl);
    registerRestRoutes(secured, service);
  });

  const address = await app.listen({ port: config.port, host: config.host });

  let syncTimer: NodeJS.Timeout | undefined;
  let stopped = false;
  if (config.gitRemoteUrl && config.gitSyncIntervalSeconds > 0) {
    const scheduleSync = (): void => {
      syncTimer = setTimeout(async () => {
        try {
          await service.syncNow();
        } catch (err) {
          app.log.error({ err }, "periodic sync failed");
        }
        if (!stopped) scheduleSync();
      }, config.gitSyncIntervalSeconds * 1000);
    };
    scheduleSync();
  }

  return {
    app,
    url: address,
    close: async () => {
      stopped = true;
      clearTimeout(syncTimer);
      await app.close();
      await storage.close();
      await mcpHandler.close();
    },
  };
}
