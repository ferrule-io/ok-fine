ok-fine is published to npm as [`@ferrule-io/ok-fine`](https://www.npmjs.com/package/@ferrule-io/ok-fine). The
package's `ok-fine` command runs the server on your machine without Docker: over stdio for agent sessions, or
over HTTP (`ok-fine serve`) for the web UI, REST API, and HTTP MCP clients.

# Requirements

- Node.js 24 or newer, and `git`.
- macOS or Linux. On Windows, use WSL.

# Stdio for agent sessions

```sh
npx -y @ferrule-io/ok-fine
```

The agent harness starts this command itself and talks MCP over its stdin/stdout; see
[Coding agents](https://github.com/ferrule-io/ok-fine/wiki/Coding-Agents#local-setup-stdio) for each harness's
command. The first run downloads the package. For faster starts, install it once with `npm i -g @ferrule-io/ok-fine`
and run `ok-fine` instead.

Knowledge lives in `~/.ok-fine` as a git repository (same layout as the container's `/data`, see
[How it works](https://github.com/ferrule-io/ok-fine/wiki/How-It-Works)). Logs go to stderr; stdout carries only
MCP messages.

# Flags

```
ok-fine [stdio|serve] [options]
```

| Flag | Variable | Default |
|---|---|---|
| `--data-dir <path>` | `DATA_DIR` | `~/.ok-fine` |
| `--remote <url>` | `GIT_REMOTE_URL` | unset (local only); accepts `https://`, `ssh://`, `user@host:path`, `file://`, or an absolute path |
| `--branch <name>` | `GIT_BRANCH` | `main` |
| `--sync-interval <sec>` | `GIT_SYNC_INTERVAL_SECONDS` | `60`; `0` disables periodic sync |
| `--log-level <level>` | `LOG_LEVEL` | `info` |
| `--port <port>` (serve) | `PORT` | `8080` |
| `--host <addr>` (serve) | `HOST` | `127.0.0.1` |
| `--public-base-url <url>` (serve) | `PUBLIC_BASE_URL` | `http://localhost:<port>` |
| `--no-auth` (serve) | `AUTH_MODE=none` | off; refuses non-loopback `--host` without `ALLOW_UNAUTHENTICATED_NETWORK=true` |
| `-h`, `--help` / `-v`, `--version` | | |

Every variable in [Configuration](https://github.com/ferrule-io/ok-fine/wiki/Configuration) also works; flags win
over variables. In harness configs, flags go after the package name:
`npx -y @ferrule-io/ok-fine --remote git@github.com:acme/knowledge.git`.

# Syncing with a git remote

```sh
npx -y @ferrule-io/ok-fine --remote git@github.com:acme/knowledge.git
```

The CLI runs git with your own environment and credentials: your ssh-agent and `~/.ssh/config`, and credential
helpers such as osxkeychain or `gh auth setup-git`. ok-fine cannot answer prompts (git runs without a terminal), so
accept the host key and unlock keys beforehand, for example by running `git ls-remote <url>` once. Your git hooks
and global ignore and attributes files are not applied to the knowledge repository. An explicit `GIT_SSH_KEY_PATH`
still overrides your ssh setup, and now also requires `GIT_SSH_KNOWN_HOSTS_PATH`. When configured, `--remote` or
`GIT_REMOTE_URL` must use a supported format: `https://…`, `ssh://…`, scp-style `user@host:path`, `file://…`, or an
absolute local path (insecure `http://` and relative paths are rejected).

# Several sessions at once

Any number of agent sessions can use the plain `npx -y @ferrule-io/ok-fine` stdio configuration at once on the same data directory. There is no need to run a background daemon or change harness settings for concurrent sessions.

The first session to start takes the exclusive lock (`~/.ok-fine/ok-fine.lock`, holding the process ID) and hosts the knowledge base. Subsequent sessions connect to the host through an owner-only local socket (`DATA_DIR/ok-fine.sock`, or a named pipe on Windows). If the hosting session ends, another session takes over the lock and becomes the host automatically. Any request in flight at the moment of failover returns a JSON-RPC error instructing the client to retry.

`ok-fine serve` remains for the read-only web UI, the REST API, and HTTP MCP clients. When `ok-fine serve --no-auth` is running, stdio sessions automatically attach to it through the same local socket; with OIDC authentication `serve` does not open the socket, so stdio sessions cannot bypass it. `ok-fine serve` cannot start while a stdio session is hosting that data directory (close the stdio sessions or specify a different `--data-dir`).

A lock left by an exited or crashed process is taken over automatically; if `serve` reports a lock held by a live process that is not ok-fine, delete the lock file.

# Identity and actors

Over stdio there is no authentication: the trust boundary is your user account, and every tool is available.
`human:<email>` actors work when the email matches `git config user.email` in the directory the client starts
ok-fine from (compared case-insensitively); with no email configured, `human:` actors are rejected. Agent actors
(`<producer>/<version>`) always work. Commits carry the trailer `Okf-Principal: sub=local client=stdio`.

# HTTP without Docker

`ok-fine serve` runs the same server as the container image (MCP and the
[REST API](https://github.com/ferrule-io/ok-fine/wiki/REST-API)), defaulting to `127.0.0.1:8080` and
`PUBLIC_BASE_URL=http://localhost:<port>`. Without `--no-auth` it requires `OAUTH_ISSUER`, as described in
[Authentication and authorization](https://github.com/ferrule-io/ok-fine/wiki/Authentication-and-Authorization).

> **Warning:** `--no-auth` (`AUTH_MODE=none`) disables authentication completely and gives every caller full admin
> access. Keep `--host` on loopback. `--no-auth` refuses to start on a non-loopback `--host`/`HOST` (127.0.0.0/8, ::1, localhost) unless `ALLOW_UNAUTHENTICATED_NETWORK=true` is set.

The read-only web UI is at `http://localhost:<port>/ui/`.

# HTTP with Docker

To run the container locally with authentication disabled behind a loopback port mapping, set `ALLOW_UNAUTHENTICATED_NETWORK=true` (since the container listens on `0.0.0.0`):

```sh
docker run --rm -p 127.0.0.1:8080:8080 -e AUTH_MODE=none -e ALLOW_UNAUTHENTICATED_NETWORK=true -e PUBLIC_BASE_URL=http://localhost:8080 -v okf-data:/data ghcr.io/ferrule-io/ok-fine:latest
```
