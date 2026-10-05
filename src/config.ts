import { z } from "zod";

export interface Logger {
  info(objOrMsg: unknown, msg?: string): void;
  warn(objOrMsg: unknown, msg?: string): void;
  error(objOrMsg: unknown, msg?: string): void;
  debug(objOrMsg: unknown, msg?: string): void;
}

export interface Config {
  port: number;
  host: string;
  logLevel: string;
  dataDir: string;
  publicBaseUrl: string;
  oauthIssuer: string;
  oauthAudiences: string[];
  oauthJwksUri?: string;
  scopeNames: {
    read: string;
    write: string;
    admin: string;
  };
  identityClaims: string[];
  allowInsecureIssuer: boolean;
  gitBranch: string;
  gitRemoteUrl?: string;
  gitSyncIntervalSeconds: number;
  gitSshKeyPath?: string;
  gitSshKnownHostsPath?: string;
  gitHttpUsername?: string;
  gitHttpPassword?: string;
  maxFileBytes: number;
  maxArchiveBytes: number;
}

/** A whole-string decimal integer env var (rejects `8080junk`, `1x`, `1.5`, and blanks). */
function intEnv(name: string, fallback: string, min: number, max = Number.MAX_SAFE_INTEGER) {
  return z
    .string()
    .default(fallback)
    .refine((v) => /^\d+$/.test(v), { message: `${name} must be a whole decimal integer` })
    .transform(Number)
    .pipe(z.number().int().min(min, `${name} must be >= ${min}`).max(max, `${name} must be <= ${max}`));
}

function httpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

const rawEnvSchema = z
  .object({
    PORT: intEnv("PORT", "8080", 0, 65535),
    HOST: z.string().default("0.0.0.0"),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
    DATA_DIR: z.string().default("/data").refine((v) => v.startsWith("/"), "DATA_DIR must be an absolute path"),
    PUBLIC_BASE_URL: z
      .string({ message: "PUBLIC_BASE_URL is required" })
      .refine(httpUrl, "PUBLIC_BASE_URL must be a valid http or https URL"),
    OAUTH_ISSUER: z.string({ message: "OAUTH_ISSUER is required" }).refine(httpUrl, "OAUTH_ISSUER must be a valid URL"),
    OAUTH_AUDIENCE: z.string().optional(),
    OAUTH_JWKS_URI: z.string().refine(httpUrl, "OAUTH_JWKS_URI must be a valid URL").optional(),
    OAUTH_SCOPE_READ: z.string().default("okf:read"),
    OAUTH_SCOPE_WRITE: z.string().default("okf:write"),
    OAUTH_SCOPE_ADMIN: z.string().default("okf:admin"),
    OAUTH_IDENTITY_CLAIMS: z.string().default("preferred_username,email,sub"),
    OAUTH_ALLOW_INSECURE_ISSUER: z.enum(["true", "false"], "OAUTH_ALLOW_INSECURE_ISSUER must be true or false").default("false"),
    GIT_BRANCH: z.string().default("main"),
    GIT_REMOTE_URL: z.string().optional(),
    GIT_SYNC_INTERVAL_SECONDS: intEnv("GIT_SYNC_INTERVAL_SECONDS", "60", 0),
    GIT_SSH_KEY_PATH: z.string().optional(),
    GIT_SSH_KNOWN_HOSTS_PATH: z.string().optional(),
    GIT_HTTP_USERNAME: z.string().optional(),
    GIT_HTTP_PASSWORD: z.string().optional(),
    MAX_FILE_BYTES: intEnv("MAX_FILE_BYTES", "1048576", 1),
    MAX_ARCHIVE_BYTES: intEnv("MAX_ARCHIVE_BYTES", "52428800", 1),
  })
  .superRefine((data, ctx) => {
    if (Boolean(data.GIT_HTTP_USERNAME) !== Boolean(data.GIT_HTTP_PASSWORD)) {
      ctx.addIssue({
        code: "custom",
        path: ["GIT_HTTP_USERNAME"],
        message: "GIT_HTTP_USERNAME and GIT_HTTP_PASSWORD must be provided together or neither",
      });
    }
  });

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const result = rawEnvSchema.safeParse(env);
  if (!result.success) {
    const errorMessages = result.error.issues.map(
      (issue) => `${issue.path.join(".") || "config"}: ${issue.message}`
    );
    throw new Error(`Configuration errors:\n  ${errorMessages.join("\n  ")}`);
  }

  const raw = result.data;
  const publicBaseUrl = raw.PUBLIC_BASE_URL.replace(/\/+$/, "");

  let oauthAudiences: string[];
  if (raw.OAUTH_AUDIENCE && raw.OAUTH_AUDIENCE.trim().length > 0) {
    oauthAudiences = raw.OAUTH_AUDIENCE.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  } else {
    oauthAudiences = [`${publicBaseUrl}/mcp`];
  }

  const identityClaims = raw.OAUTH_IDENTITY_CLAIMS.split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const allowInsecureIssuer = raw.OAUTH_ALLOW_INSECURE_ISSUER === "true";

  return {
    port: raw.PORT,
    host: raw.HOST,
    logLevel: raw.LOG_LEVEL,
    dataDir: raw.DATA_DIR,
    publicBaseUrl,
    oauthIssuer: raw.OAUTH_ISSUER,
    oauthAudiences,
    oauthJwksUri: raw.OAUTH_JWKS_URI,
    scopeNames: {
      read: raw.OAUTH_SCOPE_READ,
      write: raw.OAUTH_SCOPE_WRITE,
      admin: raw.OAUTH_SCOPE_ADMIN,
    },
    identityClaims,
    allowInsecureIssuer,
    gitBranch: raw.GIT_BRANCH,
    gitRemoteUrl: raw.GIT_REMOTE_URL,
    gitSyncIntervalSeconds: raw.GIT_SYNC_INTERVAL_SECONDS,
    gitSshKeyPath: raw.GIT_SSH_KEY_PATH,
    gitSshKnownHostsPath: raw.GIT_SSH_KNOWN_HOSTS_PATH,
    gitHttpUsername: raw.GIT_HTTP_USERNAME,
    gitHttpPassword: raw.GIT_HTTP_PASSWORD,
    maxFileBytes: raw.MAX_FILE_BYTES,
    maxArchiveBytes: raw.MAX_ARCHIVE_BYTES,
  };
}
