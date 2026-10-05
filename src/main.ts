import { loadConfig, type Config } from "./config.js";
import { startServer, type RunningServer } from "./server.js";

let config: Config;
try {
  config = loadConfig();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

let server: RunningServer;
try {
  server = await startServer(config);
} catch (err) {
  console.error("ok-fine failed to start:", err);
  process.exit(1);
}

let shuttingDown = false;
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    server.app.log.info({ signal }, "shutting down");
    server.close().then(
      () => process.exit(0),
      (err: unknown) => {
        server.app.log.error({ err }, "shutdown failed");
        process.exit(1);
      },
    );
  });
}
