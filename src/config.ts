import { z } from "zod";

export interface Logger {
  info(objOrMsg: unknown, msg?: string): void;
  warn(objOrMsg: unknown, msg?: string): void;
  error(objOrMsg: unknown, msg?: string): void;
  debug(objOrMsg: unknown, msg?: string): void;
}

export type AuthConfig =
  | { mode: "none" }
  | {
      mode: "oidc";
      issuer: string;
      audiences: string[];
      jwksUri?: string;
      identityClaims: string[];
      allowInsecureIssuer: boolean;
    };

/** Settings the storage and service layers read; enough for the stdio transport. */
export interface StorageConfig {
  logLevel: string;
  dataDir: string;
  gitBranch: string;
  gitRemoteUrl?: string;
  gitSyncIntervalSeconds: number;
  gitSshKeyPath?: string;
  gitSshKnownHostsPath?: string;
  gitHttpUsername?: string;
  gitHttpPassword?: string;
  /** Local CLI only: env for git child processes (HOME, SSH agent, git config, credential helpers). Unset = isolated HOME under DATA_DIR/home. */
  gitHostEnv?: Record<string, string>;
  maxFileBytes: number;
  maxArchiveBytes: number;
  defaultStaleAfterDays?: number;
}

export interface Config extends StorageConfig {
  port: number;
  host: string;
  publicBaseUrl: string;
  auth: AuthConfig;
  scopeNames: {
    read: string;
    write: string;
    admin: string;
  };
}

export interface LoadOptions {
  /** Local CLI runs: git inherits `env` instead of an isolated HOME. */
  inheritGitEnv?: boolean;
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

/** An optional whole-string decimal integer env var; unset or empty string evaluates to undefined. */
function optionalIntEnv(name: string, min: number, max = Number.MAX_SAFE_INTEGER) {
  return z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? undefined : v))
    .pipe(
      z
        .string()
        .refine((v) => /^\d+$/.test(v), { message: `${name} must be a whole decimal integer` })
        .transform(Number)
        .pipe(z.number().int().min(min, `${name} must be >= ${min}`).max(max, `${name} must be <= ${max}`))
        .optional(),
    );
}

function httpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

const storageEnvShape = {
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DATA_DIR: z
    .string()
    .default("/data")
    .refine((v) => v.startsWith("/"), "DATA_DIR must be an absolute path"),
  GIT_BRANCH: z.string().default("main"),
  GIT_REMOTE_URL: z.string().optional(),
  GIT_SYNC_INTERVAL_SECONDS: intEnv("GIT_SYNC_INTERVAL_SECONDS", "60", 0),
  GIT_SSH_KEY_PATH: z.string().optional(),
  GIT_SSH_KNOWN_HOSTS_PATH: z.string().optional(),
  GIT_HTTP_USERNAME: z.string().optional(),
  GIT_HTTP_PASSWORD: z.string().optional(),
  MAX_FILE_BYTES: intEnv("MAX_FILE_BYTES", "1048576", 1),
  MAX_ARCHIVE_BYTES: intEnv("MAX_ARCHIVE_BYTES", "52428800", 1),
  DEFAULT_STALE_AFTER_DAYS: optionalIntEnv("DEFAULT_STALE_AFTER_DAYS", 1, 36500),
};

const httpEnvShape = {
  AUTH_MODE: z.enum(["oidc", "none"], "AUTH_MODE must be oidc or none").default("oidc"),
  PORT: intEnv("PORT", "8080", 0, 65535),
  HOST: z.string().default("0.0.0.0"),
  PUBLIC_BASE_URL: z
    .string({ message: "PUBLIC_BASE_URL is required" })
    .refine(httpUrl, "PUBLIC_BASE_URL must be a valid http or https URL"),
  OAUTH_ISSUER: z.string().optional(),
  OAUTH_AUDIENCE: z.string().optional(),
  OAUTH_JWKS_URI: z.string().optional(),
  OAUTH_SCOPE_READ: z.string().default("okf:read"),
  OAUTH_SCOPE_WRITE: z.string().default("okf:write"),
  OAUTH_SCOPE_ADMIN: z.string().default("okf:admin"),
  OAUTH_IDENTITY_CLAIMS: z.string().default("email,preferred_username,sub"),
  OAUTH_ALLOW_INSECURE_ISSUER: z.string().optional(),
};

function refineGitCredentials(
  data: { GIT_HTTP_USERNAME?: string | undefined; GIT_HTTP_PASSWORD?: string | undefined },
  ctx: z.RefinementCtx,
): void {
  if (!data || typeof data !== "object") return;
  if (Boolean(data.GIT_HTTP_USERNAME) !== Boolean(data.GIT_HTTP_PASSWORD)) {
    ctx.addIssue({
      code: "custom",
      path: ["GIT_HTTP_USERNAME"],
      message: "GIT_HTTP_USERNAME and GIT_HTTP_PASSWORD must be provided together or neither",
    });
  }
}

const rawEnvSchema = z.object({ ...httpEnvShape, ...storageEnvShape }).superRefine(
  (data, ctx) => {
    if (!data || typeof data !== "object") return;
    refineGitCredentials(data, ctx);
    if (data.AUTH_MODE === "oidc") {
      if (data.OAUTH_ISSUER === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["OAUTH_ISSUER"],
          message: "OAUTH_ISSUER is required",
        });
      } else if (!httpUrl(data.OAUTH_ISSUER)) {
        ctx.addIssue({
          code: "custom",
          path: ["OAUTH_ISSUER"],
          message: "OAUTH_ISSUER must be a valid URL",
        });
      }
      if (data.OAUTH_JWKS_URI !== undefined && !httpUrl(data.OAUTH_JWKS_URI)) {
        ctx.addIssue({
          code: "custom",
          path: ["OAUTH_JWKS_URI"],
          message: "OAUTH_JWKS_URI must be a valid URL",
        });
      }
      if (
        data.OAUTH_ALLOW_INSECURE_ISSUER !== undefined &&
        data.OAUTH_ALLOW_INSECURE_ISSUER !== "true" &&
        data.OAUTH_ALLOW_INSECURE_ISSUER !== "false"
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["OAUTH_ALLOW_INSECURE_ISSUER"],
          message: "OAUTH_ALLOW_INSECURE_ISSUER must be true or false",
        });
      }
    }
  },
  { when: () => true },
);

const storageEnvSchema = z.object(storageEnvShape).superRefine(refineGitCredentials, { when: () => true });

function formatConfigError(error: z.ZodError): Error {
  const errorMessages = error.issues.map((issue) => `${issue.path.join(".") || "config"}: ${issue.message}`);
  return new Error(`Configuration errors:\n  ${errorMessages.join("\n  ")}`);
}

function storageFromRaw(
  raw: z.infer<typeof storageEnvSchema>,
  env: Record<string, string | undefined>,
  options: LoadOptions,
): StorageConfig {
  return {
    logLevel: raw.LOG_LEVEL,
    dataDir: raw.DATA_DIR,
    gitBranch: raw.GIT_BRANCH,
    gitRemoteUrl: raw.GIT_REMOTE_URL,
    gitSyncIntervalSeconds: raw.GIT_SYNC_INTERVAL_SECONDS,
    gitSshKeyPath: raw.GIT_SSH_KEY_PATH,
    gitSshKnownHostsPath: raw.GIT_SSH_KNOWN_HOSTS_PATH,
    gitHttpUsername: raw.GIT_HTTP_USERNAME,
    gitHttpPassword: raw.GIT_HTTP_PASSWORD,
    ...(options.inheritGitEnv
      ? {
          gitHostEnv: Object.fromEntries(Object.entries(env).filter((e): e is [string, string] => e[1] !== undefined)),
        }
      : {}),
    maxFileBytes: raw.MAX_FILE_BYTES,
    maxArchiveBytes: raw.MAX_ARCHIVE_BYTES,
    defaultStaleAfterDays: raw.DEFAULT_STALE_AFTER_DAYS,
  };
}

/** Storage-only settings for the stdio transport: needs neither PUBLIC_BASE_URL nor OAUTH_*. */
export function loadStorageConfig(env: Record<string, string | undefined>, options: LoadOptions = {}): StorageConfig {
  const result = storageEnvSchema.safeParse(env);
  if (!result.success) throw formatConfigError(result.error);
  return storageFromRaw(result.data, env, options);
}

export function loadConfig(env: Record<string, string | undefined> = process.env, options: LoadOptions = {}): Config {
  const result = rawEnvSchema.safeParse(env);
  if (!result.success) throw formatConfigError(result.error);

  const raw = result.data;
  const publicBaseUrl = raw.PUBLIC_BASE_URL.replace(/\/+$/, "");

  let auth: AuthConfig;
  if (raw.AUTH_MODE === "none") {
    auth = { mode: "none" };
  } else {
    if (raw.OAUTH_ISSUER === undefined) {
      throw new Error("OAUTH_ISSUER is required when AUTH_MODE is oidc");
    }
    let oauthAudiences: string[];
    if (raw.OAUTH_AUDIENCE && raw.OAUTH_AUDIENCE.trim().length > 0) {
      oauthAudiences = raw.OAUTH_AUDIENCE.split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    } else {
      oauthAudiences = [`${publicBaseUrl}/mcp`];
    }

    const identityClaims = raw.OAUTH_IDENTITY_CLAIMS.split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const allowInsecureIssuer = raw.OAUTH_ALLOW_INSECURE_ISSUER === "true";

    auth = {
      mode: "oidc",
      issuer: raw.OAUTH_ISSUER,
      audiences: oauthAudiences,
      ...(raw.OAUTH_JWKS_URI === undefined ? {} : { jwksUri: raw.OAUTH_JWKS_URI }),
      identityClaims,
      allowInsecureIssuer,
    };
  }

  return {
    ...storageFromRaw(raw, env, options),
    port: raw.PORT,
    host: raw.HOST,
    publicBaseUrl,
    auth,
    scopeNames: {
      read: raw.OAUTH_SCOPE_READ,
      write: raw.OAUTH_SCOPE_WRITE,
      admin: raw.OAUTH_SCOPE_ADMIN,
    },
  };
}
