import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { exportJWK, generateKeyPair, SignJWT } from "jose";

export interface DevIssuerOptions {
  port?: number;
  host?: string;
  issuerUrl?: string;
  audience?: string;
}

export interface MintTokenOptions {
  scope?: string;
  username?: string;
  expiresIn?: number;
  audience?: string;
  issuer?: string;
  claims?: Record<string, unknown>;
}

export interface DevIssuer {
  url: string;
  mintToken(opts?: MintTokenOptions): Promise<string>;
  close(): Promise<void>;
}

/**
 * Starts a minimal in-memory OAuth 2.0 / OIDC dev authorization server
 * for testing and local development.
 */
export async function startDevIssuer(options?: DevIssuerOptions): Promise<DevIssuer> {
  const port = options?.port ?? 0;
  const host = options?.host ?? "127.0.0.1";
  const defaultAudience = options?.audience;

  const keyPair = await generateKeyPair("ES256", { extractable: true });
  const publicJwk = await exportJWK(keyPair.publicKey);
  publicJwk.kid = "dev";
  publicJwk.alg = "ES256";
  publicJwk.use = "sig";

  let boundPort = port;
  let resolvedIssuerUrl = options?.issuerUrl ?? "";
  const authorizationCodes = new Map<
    string,
    {
      clientId: string;
      redirectUri: string;
      codeChallenge: string;
      scope: string;
      username: string;
      resource?: string;
      expiresAt: number;
    }
  >();

  const sendJson = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(JSON.stringify(body));
  };

  const readBody = async (req: IncomingMessage) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    }
    return Buffer.concat(chunks).toString("utf-8");
  };

  async function mintToken(opts?: MintTokenOptions): Promise<string> {
    const scope = opts?.scope ?? "okf:read okf:write okf:admin";
    const username = opts?.username ?? "dev";
    const expiresIn = opts?.expiresIn ?? 3600;
    const tokenAudience = opts?.audience ?? defaultAudience ?? "http://localhost:8080/mcp";
    const tokenIssuer = opts?.issuer ?? resolvedIssuerUrl;
    const now = Math.floor(Date.now() / 1000);
    const exp = now + expiresIn;

    const payload: Record<string, unknown> = {
      sub: `dev|${username}`,
      preferred_username: username,
      scope,
      client_id: "dev-client",
      azp: "dev-client",
      ...(opts?.claims ?? {}),
    };

    const jwt = new SignJWT(payload)
      .setProtectedHeader({ alg: "ES256", kid: "dev" })
      .setIssuedAt(now)
      .setIssuer(tokenIssuer)
      .setAudience(tokenAudience);

    // If claims explicitly set exp to undefined or null, omit setExpirationTime
    if (opts?.claims && "exp" in opts.claims && opts.claims.exp === undefined) {
      // Do not set expiration
    } else {
      jwt.setExpirationTime(exp);
    }

    return jwt.sign(keyPair.privateKey);
  }

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const parsed = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const pathname = parsed.pathname;

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "*",
      });
      res.end();
      return;
    }

    if (
      req.method === "GET" &&
      (pathname === "/.well-known/oauth-authorization-server" || pathname === "/.well-known/openid-configuration")
    ) {
      const metadata = {
        issuer: resolvedIssuerUrl,
        authorization_endpoint: `${resolvedIssuerUrl}/authorize`,
        token_endpoint: `${resolvedIssuerUrl}/token`,
        jwks_uri: `${resolvedIssuerUrl}/jwks`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "client_credentials"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
        scopes_supported: ["okf:read", "okf:write", "okf:admin"],
        registration_endpoint: `${resolvedIssuerUrl}/register`,
      };

      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(JSON.stringify(metadata, null, 2));
      return;
    }

    if (req.method === "GET" && pathname === "/jwks") {
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(JSON.stringify({ keys: [publicJwk] }, null, 2));
      return;
    }

    // Browser sign-in: auto-approves every request (login_hint sets the username).
    if (req.method === "GET" && pathname === "/authorize") {
      const q = parsed.searchParams;
      const clientId = q.get("client_id");
      const redirectUri = q.get("redirect_uri");
      const codeChallenge = q.get("code_challenge");
      if (
        q.get("response_type") !== "code" ||
        !clientId ||
        !redirectUri ||
        !codeChallenge ||
        q.get("code_challenge_method") !== "S256"
      ) {
        sendJson(res, 400, { error: "invalid_request" });
        return;
      }
      let target: URL;
      try {
        target = new URL(redirectUri);
      } catch {
        sendJson(res, 400, { error: "invalid_request" });
        return;
      }
      const code = randomBytes(24).toString("base64url");
      const resource = q.get("resource");
      authorizationCodes.set(code, {
        clientId,
        redirectUri,
        codeChallenge,
        scope: q.get("scope") || "okf:read okf:write okf:admin",
        username: q.get("login_hint") || "dev",
        ...(resource ? { resource } : {}),
        expiresAt: Date.now() + 60_000,
      });
      target.searchParams.set("code", code);
      const state = q.get("state");
      if (state !== null) target.searchParams.set("state", state);
      res.writeHead(302, { Location: target.toString() });
      res.end();
      return;
    }

    if (req.method === "POST" && pathname === "/register") {
      let metadata: unknown;
      try {
        metadata = JSON.parse(await readBody(req));
      } catch {
        sendJson(res, 400, { error: "invalid_client_metadata" });
        return;
      }
      if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
        sendJson(res, 400, { error: "invalid_client_metadata" });
        return;
      }
      sendJson(res, 201, {
        ...metadata,
        client_id: `dev-${randomUUID()}`,
        client_id_issued_at: Math.floor(Date.now() / 1000),
        token_endpoint_auth_method: "none",
      });
      return;
    }

    if (req.method === "POST" && pathname === "/token") {
      const bodyStr = await readBody(req);

      const contentType = req.headers["content-type"] ?? "";
      const isJson = contentType.includes("application/json") || bodyStr.trim().startsWith("{");
      if (!isJson) {
        const form = new URLSearchParams(bodyStr);
        if (form.get("grant_type") === "authorization_code") {
          const code = form.get("code") ?? "";
          const entry = authorizationCodes.get(code);
          authorizationCodes.delete(code);
          const verifier = form.get("code_verifier") ?? "";
          if (
            !entry ||
            entry.expiresAt < Date.now() ||
            form.get("client_id") !== entry.clientId ||
            form.get("redirect_uri") !== entry.redirectUri ||
            createHash("sha256").update(verifier).digest("base64url") !== entry.codeChallenge
          ) {
            sendJson(res, 400, { error: "invalid_grant" });
            return;
          }
          const accessToken = await mintToken({
            scope: entry.scope,
            username: entry.username,
            audience: entry.resource ?? defaultAudience,
          });
          sendJson(res, 200, { access_token: accessToken, token_type: "Bearer", expires_in: 3600, scope: entry.scope });
          return;
        }
      }
      let scope = "okf:read okf:write okf:admin";
      let username = "dev";

      if (bodyStr.trim().length > 0) {
        if (isJson) {
          try {
            const parsedJson = JSON.parse(bodyStr) as Record<string, unknown>;
            if (typeof parsedJson.scope === "string") scope = parsedJson.scope;
            if (typeof parsedJson.username === "string") username = parsedJson.username;
          } catch {
            // ignore JSON parse error, use defaults
          }
        } else {
          const params = new URLSearchParams(bodyStr);
          const pScope = params.get("scope");
          const pUsername = params.get("username");
          if (pScope !== null) scope = pScope;
          if (pUsername !== null) username = pUsername;
        }
      }

      const accessToken = await mintToken({
        scope,
        username,
        audience: defaultAudience,
        issuer: resolvedIssuerUrl,
      });

      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(
        JSON.stringify({
          access_token: accessToken,
          token_type: "Bearer",
          expires_in: 3600,
          scope,
        }),
      );
      return;
    }

    res.writeHead(404, {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(JSON.stringify({ error: "not_found" }));
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(port, host, () => resolve());
    server.once("error", reject);
  });

  const addr = server.address();
  boundPort = typeof addr === "object" && addr ? addr.port : port;
  resolvedIssuerUrl = options?.issuerUrl ?? `http://${host}:${boundPort}`;

  return {
    url: resolvedIssuerUrl,
    mintToken,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
  };
}
