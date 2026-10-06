ok-fine is published to npm as [`@ferrule-io/ok-fine`](https://www.npmjs.com/package/@ferrule-io/ok-fine). The
package's `ok-fine` command runs the server on your machine without Docker: over stdio for one agent session, or
over HTTP (`ok-fine serve`) for several.

# Requirements

- Node.js 24 or newer, and `git`.
- macOS or Linux. On Windows, use WSL.

# Stdio for one agent session

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
| `--remote <url>` | `GIT_REMOTE_URL` | unset (local only) |
| `--branch <name>` | `GIT_BRANCH` | `main` |
| `--sync-interval <sec>` | `GIT_SYNC_INTERVAL_SECONDS` | `60`; `0` disables periodic sync |
| `--log-level <level>` | `LOG_LEVEL` | `info` |
| `--port <port>` (serve) | `PORT` | `8080` |
| `--host <addr>` (serve) | `HOST` | `127.0.0.1` |
| `--public-base-url <url>` (serve) | `PUBLIC_BASE_URL` | `http://localhost:<port>` |
| `--no-auth` (serve) | `AUTH_MODE=none` | off |
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
still overrides your ssh setup.

# Several sessions at once

One process serves a data directory. A second `ok-fine` started on the same data directory exits with
`ok-fine is already running on … (pid …)`. To share one knowledge base between concurrent sessions, run the HTTP
server once:

```sh
npx -y @ferrule-io/ok-fine serve --no-auth
```

and point every client at `http://localhost:8080/mcp` (the HTTP rows in
[Coding agents](https://github.com/ferrule-io/ok-fine/wiki/Coding-Agents#per-harness-setup-shared-server), with no
login step). Or give each session its own `--data-dir`.

The lock is the file `~/.ok-fine/ok-fine.lock`, holding the process ID. A lock left by a crashed process is taken
over automatically; if the message names a process that is not ok-fine, delete the file.

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
> access. Keep `--host` on loopback.

The read-only web UI is at `http://localhost:<port>/ui/`.
