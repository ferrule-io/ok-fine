import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

export type CliCommand = "stdio" | "serve" | "help" | "version";

export interface CliInvocation {
  command: CliCommand;
  /** Environment for `loadConfig`/`loadStorageConfig`: CLI defaults < process env < flags. */
  env: Record<string, string | undefined>;
}

export const USAGE = `Usage: ok-fine [stdio|serve] [options]

Commands:
  stdio (default)          Serve MCP over stdin/stdout for one local client
  serve                    Serve MCP and the REST API over HTTP

Options:
  --data-dir <path>        Knowledge repository location (DATA_DIR, default ~/.ok-fine)
  --remote <url>           Git remote to sync with, using your git credentials (GIT_REMOTE_URL)
  --branch <name>          Git branch (GIT_BRANCH, default main)
  --sync-interval <sec>    Periodic sync interval, 0 disables (GIT_SYNC_INTERVAL_SECONDS, default 60)
  --log-level <level>      fatal|error|warn|info|debug|trace|silent (LOG_LEVEL, default info)
  -h, --help               Show this help
  -v, --version            Print the version

serve options:
  --port <port>            PORT, default 8080
  --host <addr>            HOST, default 127.0.0.1
  --public-base-url <url>  PUBLIC_BASE_URL, default http://localhost:<port>
  --no-auth                AUTH_MODE=none: no authentication, every caller is admin; localhost only

Every variable in https://github.com/ferrule-io/ok-fine/wiki/Configuration also works; flags win.
`;

const FLAG_ENV: Record<string, string> = {
  "data-dir": "DATA_DIR",
  remote: "GIT_REMOTE_URL",
  branch: "GIT_BRANCH",
  "sync-interval": "GIT_SYNC_INTERVAL_SECONDS",
  "log-level": "LOG_LEVEL",
  port: "PORT",
  host: "HOST",
  "public-base-url": "PUBLIC_BASE_URL",
};

const SERVE_ONLY_FLAGS = ["port", "host", "public-base-url", "no-auth"] as const;

/** Pure: maps argv and the process env to a command and the env its config loader reads. Throws on bad usage. */
export function parseCli(argv: string[], env: Record<string, string | undefined>, homeDir: string): CliInvocation {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      "data-dir": { type: "string" },
      remote: { type: "string" },
      branch: { type: "string" },
      "sync-interval": { type: "string" },
      "log-level": { type: "string" },
      port: { type: "string" },
      host: { type: "string" },
      "public-base-url": { type: "string" },
      "no-auth": { type: "boolean" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });

  if (values.help) return { command: "help", env };
  if (values.version) return { command: "version", env };

  let command: "stdio" | "serve";
  if (positionals.length === 0 || (positionals.length === 1 && positionals[0] === "stdio")) {
    command = "stdio";
  } else if (positionals.length === 1 && positionals[0] === "serve") {
    command = "serve";
  } else {
    throw new Error(`unknown command "${positionals.join(" ")}"`);
  }

  if (command === "stdio") {
    for (const name of SERVE_ONLY_FLAGS) {
      if (values[name] !== undefined) throw new Error(`--${name} only applies to "ok-fine serve"`);
    }
  }

  const flagEnv: Record<string, string> = {};
  for (const [flag, envName] of Object.entries(FLAG_ENV)) {
    const value = values[flag as keyof typeof values];
    if (typeof value === "string") flagEnv[envName] = value;
  }
  const dataDirFlag = values["data-dir"];
  if (dataDirFlag !== undefined) {
    const expanded =
      dataDirFlag === "~" ? homeDir : dataDirFlag.startsWith("~/") ? join(homeDir, dataDirFlag.slice(2)) : dataDirFlag;
    flagEnv.DATA_DIR = resolve(expanded);
  }
  if (values["no-auth"]) flagEnv.AUTH_MODE = "none";

  const defaults: Record<string, string> = { DATA_DIR: join(homeDir, ".ok-fine") };
  if (command === "serve") defaults.HOST = "127.0.0.1";

  const merged: Record<string, string | undefined> = { ...defaults, ...env, ...flagEnv };
  if (command === "serve" && merged.PUBLIC_BASE_URL === undefined) {
    merged.PUBLIC_BASE_URL = `http://localhost:${merged.PORT ?? "8080"}`;
  }
  return { command, env: merged };
}
