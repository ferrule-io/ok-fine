import { z } from "zod";

export interface DiscoveryOptions {
  timeoutMs?: number;
  jwksUri?: string;
}

export interface DiscoveredAuthorizationServer {
  metadata: Record<string, unknown>;
  jwksUri: string;
}

const DiscoveryMetadata = z
  .object({
    issuer: z.string(),
    jwks_uri: z.string().optional(),
  })
  .passthrough();

/**
 * Discovers authorization server metadata via RFC 8414 or OIDC Discovery.
 * Candidate URLs in order:
 * 1. origin + "/.well-known/oauth-authorization-server" + p (RFC 8414)
 * 2. base + "/.well-known/openid-configuration" (OIDC)
 */
export async function discoverAuthorizationServer(
  issuer: string,
  options?: DiscoveryOptions
): Promise<DiscoveredAuthorizationServer> {
  const timeoutMs = options?.timeoutMs ?? 5000;
  const base = issuer.replace(/\/+$/, "");
  const parsed = new URL(issuer);
  const origin = parsed.origin;
  const p = parsed.pathname.replace(/\/+$/, "");

  const candidateUrls = [
    `${origin}/.well-known/oauth-authorization-server${p}`,
    `${base}/.well-known/openid-configuration`,
  ];

  let metadata: Record<string, unknown> | null = null;
  let discoveredJwksUri: string | undefined;

  for (const candidateUrl of candidateUrls) {
    try {
      const res = await fetch(candidateUrl, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { Accept: "application/json" },
      });
      if (res.status !== 200) {
        continue;
      }
      const data: unknown = await res.json();
      const parsedMeta = DiscoveryMetadata.safeParse(data);
      if (parsedMeta.success && parsedMeta.data.issuer === issuer) {
        metadata = parsedMeta.data;
        discoveredJwksUri = parsedMeta.data.jwks_uri;
        break;
      }
    } catch {
      // Try next candidate
    }
  }

  if (!metadata) {
    throw new Error(`authorization server discovery failed for ${issuer}`);
  }

  const jwksUri = options?.jwksUri ?? discoveredJwksUri;

  if (!jwksUri) {
    throw new Error(`authorization server discovery failed for ${issuer}: missing jwks_uri`);
  }

  return { metadata, jwksUri };
}
