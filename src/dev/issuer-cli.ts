import { startDevIssuer } from "./issuer.js";

// Kubernetes injects `DEV_ISSUER_PORT=tcp://<ip>:<port>` when a Service named `dev-issuer` exists in the
// namespace; only a plain integer is treated as a port override.
const rawPort = process.env.DEV_ISSUER_PORT ?? "";
const port = /^\d+$/.test(rawPort) ? Number(rawPort) : 9000;
const host = process.env.DEV_ISSUER_HOST ?? "127.0.0.1";
const issuerUrl = process.env.DEV_ISSUER_URL ?? "http://localhost:9000";
const audience = process.env.DEV_ISSUER_AUDIENCE ?? "http://localhost:8080/mcp";

const issuer = await startDevIssuer({
  port,
  host,
  issuerUrl,
  audience,
});

console.log(`Dev issuer running at: ${issuer.url}`);
console.log(`Mint token example:\n  curl -s -X POST ${issuer.url}/token -d 'scope=okf:read okf:write' -d username=dev`);
console.log(
  `Browser sign-in: ${issuer.url}/authorize auto-approves (login_hint sets the username); set OAUTH_UI_CLIENT_ID to any value or leave it unset for /register`,
);

const shutdown = async () => {
  await issuer.close();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
