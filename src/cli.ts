#!/usr/bin/env node
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { pino } from "pino";
import { type CliInvocation, parseCli, USAGE } from "./cli-options.js";
import { type Config, loadConfig, loadStorageConfig, type StorageConfig } from "./config.js";
import { lockDataDir } from "./data-dir-lock.js";
import { type RunningServer, type RunningStdioServer, startServer, startStdioServer } from "./server.js";
import { VERSION } from "./version.js";

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** `git config user.email` in the launch directory; null when unset or git is unavailable. Not `Git`: it forces ok-fine's own email. */
function localGitEmail(env: Record<string, string | undefined>): Promise<string | null> {
  const { promise, resolve } = Promise.withResolvers<string | null>();
  execFile("git", ["config", "user.email"], { env }, (error, stdout) => {
    const email = String(stdout).trim();
    resolve(error || email.length === 0 ? null : email);
  });
  return promise;
}

/** Runs `close` once on the first trigger, then exits. */
function shutdownOnce(close: () => Promise<void>, onError: (err: unknown) => void): () => void {
  let shuttingDown = false;
  return () => {
    if (shuttingDown) return;
    shuttingDown = true;
    close().then(
      () => process.exit(0),
      (err: unknown) => {
        onError(err);
        process.exit(1);
      },
    );
  };
}

let inv: CliInvocation;
try {
  inv = parseCli(process.argv.slice(2), process.env, homedir());
} catch (err) {
  console.error(`${message(err)}\nRun "ok-fine --help" for usage.`);
  process.exit(2);
}

if (inv.command === "help") {
  process.stdout.write(USAGE);
  process.exit(0);
}
if (inv.command === "version") {
  process.stdout.write(`${VERSION}\n`);
  process.exit(0);
}

if (inv.command === "stdio") {
  let config: StorageConfig;
  try {
    config = loadStorageConfig(inv.env, { inheritGitEnv: true });
  } catch (err) {
    console.error(message(err));
    process.exit(1);
  }

  // stdout carries JSON-RPC only; every log line goes to stderr.
  const log = pino({ level: config.logLevel }, pino.destination({ dest: 2, sync: true }));

  try {
    const release = await lockDataDir(config.dataDir);
    process.once("exit", release);
  } catch (err) {
    log.error(message(err));
    process.exit(1);
  }

  const identity = await localGitEmail(inv.env);
  log.info({ dataDir: config.dataDir, identity }, "serving MCP over stdio");

  let server: RunningStdioServer;
  try {
    server = await startStdioServer(config, { log, identity });
  } catch (err) {
    log.error({ err }, "ok-fine failed to start");
    process.exit(1);
  }

  const shutdown = shutdownOnce(
    () => server.close(),
    (err) => log.error({ err }, "shutdown failed"),
  );
  void server.done.then(shutdown);
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
} else {
  let config: Config;
  try {
    config = loadConfig(inv.env, { inheritGitEnv: true });
  } catch (err) {
    console.error(message(err));
    process.exit(1);
  }

  try {
    const release = await lockDataDir(config.dataDir);
    process.once("exit", release);
  } catch (err) {
    console.error(message(err));
    process.exit(1);
  }

  let server: RunningServer;
  try {
    server = await startServer(config);
  } catch (err) {
    console.error("ok-fine failed to start:", err);
    process.exit(1);
  }

  const shutdown = shutdownOnce(
    () => {
      server.app.log.info("shutting down");
      return server.close();
    },
    (err) => server.app.log.error({ err }, "shutdown failed"),
  );
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
