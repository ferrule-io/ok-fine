ok-fine works with Claude Code, OpenAI Codex CLI, Gemini CLI, pi, and oh-my-pi (omp) on existing codebases
without changing a single file in them. There is no `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.mcp.json`, or
settings file to commit: knowledge and the repository-to-project binding both live in ok-fine. Each developer
installs one agent package and configures the ok-fine MCP server once per harness.

The agent package is built from [`agents/`](https://github.com/ferrule-io/ok-fine/tree/main/agents) and published to
[`ferrule-io/ok-fine-agents`](https://github.com/ferrule-io/ok-fine-agents) on every release. It contains:

- three [Agent Skills](https://agentskills.io): `ok-fine` (find the project, recall before work, record after),
  `ok-fine-onboard` (bind a repository and bootstrap knowledge), and `ok-fine-review` (lint, staleness, drift,
  verification);
- a SessionStart hook (Claude Code, Codex, Gemini CLI) and a pi/omp extension that tell the agent which git remote
  the session is in. They run locally and never call ok-fine.

# Lifecycle

| Stage | Who / when | Mechanism |
|---|---|---|
| 1. Org setup | Once per org | Deploy ok-fine and configure the identity provider (below). Single developer: skip and run ok-fine locally over stdio (below). |
| 2. Developer setup | Once per developer per harness | Install the package, add a user-scope MCP server named `ok-fine`, and log in with the harness's OAuth flow (HTTP only). |
| 3. Repository onboarding | Once per codebase, by anyone with `okf:write` | Ask the agent to "onboard this repository to ok-fine". The `ok-fine-onboard` skill creates or picks the project, adds the git remote to the overview's `repositories`, and bootstraps up to 30 concepts, each with `sources[].commit` and a `stale_after` 180 days out. The codebase is untouched. |
| 4. Every session | Automatic | The hook/extension tells the agent the repository URL; server instructions and the `ok-fine` skill drive `list_projects(repository=…)`, recall (overview, index, search) before work, and capture of durable knowledge after. On recall the agent checks each concept's code sources for drift since `sources[].commit` (treating a commit that is not an ancestor of HEAD as drifted, since `<commit>..HEAD` alone would miss unmerged branches); a stale or drifted concept is re-checked against the code and, without asking the user, corrected if needed, refreshed (`commit` → HEAD, `stale_after` + 180 days), and agent-verified. Work on unmerged branches is recorded as `proposals/<slug>` (with `proposal.ref`) and promoted to `decisions/<slug>` once it is grounded in the mainline (see Proposals below). |
| 5. Maintenance | On demand | Ask the agent to "review ok-fine knowledge". The `ok-fine-review` skill runs lint, finds stale, unverified, drifted, and `stale_after`-less concepts, resolves landed and abandoned proposals, and refreshes and agent-verifies concepts without a human gate. Deprecations (including resolved proposals) and deletions wait for confirmation; human verification is an optional correction step recorded only on explicit confirmation. |

# Repository binding

A project is bound to codebases through the `repositories` list in its `overview` frontmatter:

```yaml
type: Project
title: Shop
repositories:
  - git@github.com:acme/shop.git
```

`list_projects` (and `GET /api/v1/projects?repository=`) normalizes remotes before comparing: scheme, userinfo,
port, and a trailing `.git` are dropped and the result is lowercased, so `git@github.com:Acme/Shop.git`,
`https://github.com/acme/shop`, and `ssh://git@github.com:22/acme/shop` all match `github.com/acme/shop`. Local
paths are rejected with `bad_request`. One repository may be bound to several projects (and one project to
several repositories) for monorepo splits and multi-repo products.

# Identity provider requirements

- Audience `<PUBLIC_BASE_URL>/mcp`, JWT access tokens. Agent tokens need scopes `okf:read okf:write`; `okf:admin` is reserved for operators (e.g. project deletion, archive import, and manual sync).
- The `iss` parameter in authorization responses (RFC 9207); Gemini CLI rejects responses without it.
- Dynamic client registration or client ID metadata documents, or one public client with loopback redirect URIs
  that developers pass as the client ID below.

# Local setup (stdio)

Without a shared server, each harness starts ok-fine itself from npm
([Running locally](https://github.com/ferrule-io/ok-fine/wiki/Running-Locally)); knowledge lives in `~/.ok-fine`.
Requires Node.js 24+ and git.

| Harness | Add server |
|---|---|
| Claude Code | `claude mcp add --scope user ok-fine -- npx -y @ferrule-io/ok-fine` |
| Codex CLI | `codex mcp add ok-fine -- npx -y @ferrule-io/ok-fine` |
| Gemini CLI | `~/.gemini/settings.json`: `{"mcpServers":{"ok-fine":{"command":"npx","args":["-y","@ferrule-io/ok-fine"]}}}` |
| pi | `~/.pi/agent/mcp.json`: `{"mcpServers":{"ok-fine":{"command":"npx","args":["-y","@ferrule-io/ok-fine"],"exposure":"direct"}}}` |
| omp | `~/.omp/agent/mcp.json`: `{"mcpServers":{"ok-fine":{"type":"stdio","command":"npx","args":["-y","@ferrule-io/ok-fine"]}}}` |

- Install the agent package as in the table below; there is no login step.
- Flags go after the package name, e.g. `npx -y @ferrule-io/ok-fine --remote git@github.com:acme/knowledge.git`.
  Gemini CLI uses `settings.json` because `gemini mcp add` would parse `-y` itself.
- Any number of agent sessions can use this stdio setup at the same time on the same data directory. The first session hosts the knowledge base and additional sessions connect to it via an owner-only local socket (`DATA_DIR/ok-fine.sock`), with automatic failover if the host exits (see [Running locally](https://github.com/ferrule-io/ok-fine/wiki/Running-Locally#several-sessions-at-once)).

# Per-harness setup (shared server)

Replace `https://okf.example.com` with your `PUBLIC_BASE_URL`.

| Harness | Install package | Add server | Log in |
|---|---|---|---|
| Claude Code | `claude plugin marketplace add ferrule-io/ok-fine-agents` then `claude plugin install ok-fine@ok-fine` | `claude mcp add --transport http --scope user ok-fine https://okf.example.com/mcp` (pre-registered client: add `--client-id <id> --callback-port <port>`) | `/mcp` |
| Codex CLI | `codex plugin marketplace add ferrule-io/ok-fine-agents`, install `ok-fine` from `/plugins`, trust its hook in `/hooks` | `codex mcp add ok-fine --url https://okf.example.com/mcp` (pre-registered: `--oauth-client-id <id>`) | `codex mcp login ok-fine` |
| Gemini CLI | `gemini extensions install https://github.com/ferrule-io/ok-fine-agents --auto-update` | `gemini mcp add -s user -t http ok-fine https://okf.example.com/mcp` (pre-registered: `oauth.clientId` in `~/.gemini/settings.json`) | `/mcp auth ok-fine` |
| pi | `pi install git:github.com/ferrule-io/ok-fine-agents` | `~/.pi/agent/mcp.json`: `{"mcpServers":{"ok-fine":{"url":"https://okf.example.com/mcp","exposure":"direct"}}}` (pre-registered: `oauth.clientId`/`callbackPort`) | `pi mcp login ok-fine` |
| omp | `omp plugin marketplace add ferrule-io/ok-fine-agents` then `omp plugin install ok-fine@ok-fine` | `~/.omp/agent/mcp.json`: `{"mcpServers":{"ok-fine":{"type":"http","url":"https://okf.example.com/mcp"}}}` | `/mcp reauth ok-fine` |

Headless use without OAuth: mint a token and pass it as a static header — Claude Code
`--header "Authorization: Bearer ${OKF_TOKEN}"`, Codex `--bearer-token-env-var OKF_TOKEN`, pi/omp
`"headers": {"Authorization": "Bearer ${OKF_TOKEN}"}`.

# Daily use

Say "onboard this repository to ok-fine" once per codebase, then work normally: the agent recalls relevant
knowledge before non-trivial tasks and records durable decisions, conventions, and runbooks afterwards. Say
"review ok-fine knowledge" to audit and refresh it. Nothing is ever written into the codebase.

## Proposals

Knowledge about work on an unmerged branch or PR is recorded as a proposal (`proposals/<slug>`, usually `type: Decision`, `status: draft`, with extension frontmatter key `proposal: { ref: <URI> }`), never editing current-state concepts. The body captures the design, alternatives, and bundle-absolute links to the current-state concepts it would change.

- **Recall ordering:** Concepts carrying `proposal` are not current truth; they rank after current (fresh and stale/drifted) concepts and before deprecated ones. They are exempt from drift refresh while the branch is unmerged.
- **Resolving:** a proposal has landed once what it describes is grounded in the mainline (the branch the team integrates into, e.g. the remote's default branch): its source commits are ancestors of the mainline, or the code it describes is present there. `ref` is any URI (pull/merge request, branch, ticket, …) and only a hint that the agent may interpret with whatever tools its environment offers.
  - *Landed:* create `decisions/<slug>` (`status: stable`, no `proposal` key) and refresh the linked current-state concepts, both confirmed against the mainline with sources at the mainline commit (not a feature branch's HEAD). Deprecating the old proposal (`status: deprecated` with a successor link to `decisions/<slug>`) is proposed for explicit user confirmation.
  - *Abandoned* (nothing landed and the evidence shows the work was dropped): propose `status: deprecated` to the user; apply only on confirmation.
  - *Otherwise:* leave the proposal as-is.
