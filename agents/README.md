# ok-fine agent package

> **Generated repository.** `ferrule-io/ok-fine-agents` is published from
> [`ferrule-io/ok-fine/agents`](https://github.com/ferrule-io/ok-fine/tree/main/agents) by ok-fine releases that
> change the agent package. Send changes there; edits made here are overwritten.

Connects Claude Code, OpenAI Codex CLI, Gemini CLI, pi, and oh-my-pi (omp) to an
[ok-fine](https://github.com/ferrule-io/ok-fine) knowledge server as shared project memory, without changing any
file in your codebases. It ships three Agent Skills (`ok-fine`, `ok-fine-onboard`, `ok-fine-review`), a hook for
Claude Code, Codex, and Gemini CLI and an extension for pi and omp that tell the agent which git repository
it is in and to look up its ok-fine project before planning or editing; the full reminder is injected at session
start, then a one-line reminder on each prompt until the session has called an ok-fine lookup tool
(`list_projects`, `search_concepts`, `read_concept`, `get_index`). See
[Using ok-fine from coding agents](https://github.com/ferrule-io/ok-fine/wiki/Coding-Agents) for the
full lifecycle and identity-provider requirements.

## Setup

### Local (no server)

Each harness starts ok-fine itself from npm (Node.js 24+ and git required); knowledge lives in `~/.ok-fine`. Install
the package as in the shared-server table below, skip the login, and add the server:

| Harness | Add server |
|---|---|
| Claude Code | `claude mcp add --scope user ok-fine -- npx -y @ferrule-io/ok-fine` |
| Codex CLI | `codex mcp add ok-fine -- npx -y @ferrule-io/ok-fine` |
| Gemini CLI | `~/.gemini/settings.json`: `{"mcpServers":{"ok-fine":{"command":"npx","args":["-y","@ferrule-io/ok-fine"]}}}` |
| pi | `~/.pi/agent/mcp.json`: `{"mcpServers":{"ok-fine":{"command":"npx","args":["-y","@ferrule-io/ok-fine"],"exposure":"direct"}}}` |
| omp | `~/.omp/agent/mcp.json`: `{"mcpServers":{"ok-fine":{"type":"stdio","command":"npx","args":["-y","@ferrule-io/ok-fine"]}}}` |

Git remotes, flags, and concurrent sessions:
[Running locally](https://github.com/ferrule-io/ok-fine/wiki/Running-Locally).

### Shared server

Replace `https://okf.example.com` with your ok-fine server's `PUBLIC_BASE_URL`.

| Harness | Install package | Add server | Log in |
|---|---|---|---|
| Claude Code | `claude plugin marketplace add ferrule-io/ok-fine-agents` then `claude plugin install ok-fine@ok-fine` | `claude mcp add --transport http --scope user ok-fine https://okf.example.com/mcp` (pre-registered client: add `--client-id <id> --callback-port <port>`) | `/mcp` |
| Codex CLI | `codex plugin marketplace add ferrule-io/ok-fine-agents`, install `ok-fine` from `/plugins`, trust its hook in `/hooks` | `codex mcp add ok-fine --url https://okf.example.com/mcp` (pre-registered: `--oauth-client-id <id>`) | `codex mcp login ok-fine` |
| Gemini CLI | `gemini extensions install https://github.com/ferrule-io/ok-fine-agents --auto-update` | `gemini mcp add -s user -t http ok-fine https://okf.example.com/mcp` (pre-registered: `oauth.clientId` in `~/.gemini/settings.json`) | `/mcp auth ok-fine` |
| pi | `pi install git:github.com/ferrule-io/ok-fine-agents` | `~/.pi/agent/mcp.json`: `{"mcpServers":{"ok-fine":{"url":"https://okf.example.com/mcp","exposure":"direct"}}}` (pre-registered: `oauth.clientId`/`callbackPort`) | `pi mcp login ok-fine` |
| omp | `omp plugin marketplace add ferrule-io/ok-fine-agents` then `omp plugin install ok-fine@ok-fine` | `~/.omp/agent/mcp.json`: `{"mcpServers":{"ok-fine":{"type":"http","url":"https://okf.example.com/mcp"}}}` | `/mcp reauth ok-fine` |

Then, once per codebase, ask the agent to "onboard this repository to ok-fine". Outside a repository (such as in Claude Desktop), ask it to "onboard the <team> team to ok-fine", which runs a short interview and seeds draft concepts for the owner to review. Afterwards work normally; ask it to
"review ok-fine knowledge" to audit and refresh what it knows.
