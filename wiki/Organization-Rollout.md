ok-fine serves as an organization-wide remote Model Context Protocol (MCP) connector for both coding
agents and non-coding chat users (such as support, operations, product, and leadership teams). While coding
agents derive their active project from a local git repository remote, desktop and web chat clients operate
without a local working directory, shell access, or git commands.

# Project discovery without a repository

When an assistant or agent resolves which ok-fine project to use, project resolution follows this order:

1. **Explicit project in instructions or prompt:** If the user or the harness's project or workspace instructions
   (such as Claude Project instructions or custom GPT instructions) name a project explicitly, use it directly.
2. **Repository remote matching (coding agents):** In a git repository with a remote, call `list_projects` with
   `repository` set to the remote URL (derived from `git remote get-url origin`, falling back to the first remote).
   If no project matches, report that the repository is not onboarded and offer the `ok-fine-onboard` skill.
3. **General fallback (desktop and non-coding chat):** Otherwise (no repository, no shell, or no git remote), call
   `list_projects` with no arguments, pick the project(s) whose title and description fit the question, and call
   `search_concepts` without `project` to search across all projects. Never run git commands and never say "not
   onboarded" or offer onboarding on this path. If several projects fit, read from all of them; ask the user before
   writing only when the write target is ambiguous.

## MCP instruction delivery

Remote custom connectors in claude.ai and Claude Desktop drop the `instructions` string returned during MCP
initialization ([anthropics/claude-ai-mcp#93](https://github.com/anthropics/claude-ai-mcp/issues/93)). Tool
descriptions arrive intact. Because server-level instructions do not reach the model in these harnesses, routing
guidance travels in individual tool descriptions, the `ok-fine` skill, and workspace-level project instructions.

# Client registration and identity provider

The identity provider (IdP), not ok-fine, handles client registration. ok-fine operates purely as an OAuth 2.1
resource server: it does not issue tokens and does not maintain client credentials.

Depending on the connector platform and your IdP capabilities, use one of the following methods to establish the
client relationship:

- **Dynamic Client Registration (RFC 7591):** If supported and enabled on your IdP, the chat platform dynamically
  registers an OAuth client when the connector is configured.
- **Client ID metadata documents:** The platform retrieves client configuration directly from a published metadata
  URL.
- **Pre-registered client:** The administrator creates an OAuth client in the IdP beforehand (configured for the
  authorization code flow with PKCE and the connector's callback redirect URI) and enters the resulting client ID
  and client secret in the connector settings.

ok-fine only validates JWT access tokens supplied in the `Authorization: Bearer <token>` header on each request to
`https://<host>/mcp`. Tokens must carry audience `<PUBLIC_BASE_URL>/mcp` (or configured `OAUTH_AUDIENCE`); connectors
that send RFC 8707 `resource` obtain this audience automatically, while others require audience mapping configured in
the IdP. It validates token signatures against the IdP's JWKS, verifies that `iss` matches `OAUTH_ISSUER`, and enforces
scopes (`okf:read` for read tools, `okf:write` for write tools).

To prevent unauthorized access across the IdP, administrators should restrict accepted tokens with ok-fine's access
policy by setting `OAUTH_ALLOWED_CLIENT_IDS` for the registered connector client IDs, alongside `OAUTH_REQUIRED_GROUPS`
or `OAUTH_ALLOWED_EMAILS`. See
[Authentication and authorization](https://github.com/ferrule-io/ok-fine/wiki/Authentication-and-Authorization) for
complete token requirements and access policy settings.
# Platform setup

## Claude (Team and Enterprise)

1. **Add organization connector:** An organization owner or administrator navigates to the admin settings connectors
   page and adds ok-fine as an organization custom connector with the remote MCP URL `https://<host>/mcp`. Members
   connect using their individual OAuth logins against your IdP.
2. **Distribute skills:** Add the plugin marketplace `ferrule-io/ok-fine-agents` (its Claude plugin root is
   `claude-code/`) so organization members can install the ok-fine skills. Desktop harnesses run no hooks; the skill
   and tool descriptions carry all routing and usage guidance.
3. **Configure Claude Projects:** Create team-specific or domain-specific Claude Projects. In each project's
   instructions, name the default ok-fine project:

   ```text
   Use the ok-fine project `support` for questions about our processes; search it with search_concepts before answering and cite concepts.
   ```

## ChatGPT (Business, Enterprise, and Edu)

Connector and MCP feature availability varies across plans and updates; check your plan's administrative documentation
for current MCP connector support.

1. **Add workspace connector:** A workspace administrator adds ok-fine as a custom MCP connector in the admin
   settings connectors page using the remote MCP URL `https://<host>/mcp` and configures OAuth authentication.
2. **Configure custom GPTs:** Create custom GPTs tailored to specific teams or functions. In the GPT instructions,
   specify the default ok-fine project:

   ```text
   Use the ok-fine project `support` for questions about our processes; search it with search_concepts before answering and cite concepts.
   ```

## Microsoft Copilot Studio

1. **Add MCP server tool:** In Copilot Studio, add ok-fine as an MCP server tool within an agent, pointing to the
   remote endpoint URL `https://<host>/mcp`.
2. **Configure authentication:** Configure OAuth authentication to match your IdP parameters (audience, issuer, and
   scopes `okf:read` / `okf:write`).
3. **Agent instructions:** Set the agent's system instructions to direct lookups to the relevant ok-fine project
   using `search_concepts` and `read_concept`.

# Concept freshness and drift for non-code knowledge

In non-coding desktop environments, concepts often describe business rules, workflows, or external documentation
rather than git-tracked source code.

- **Freshness without code sources:** A concept with no code sources is considered fresh when `stale_after` is set
  and is not in the past.
- **Drift detection:** Non-code sources define `resource` as a URL (or other stable URI) without a `commit` property.
  When a tool available in the session can fetch the source's `resource` URL and report its last-modified timestamp,
  a source modified after the concept's `generated.at` timestamp counts as drifted.
- **Refresh:** Stale or drifted concepts should be re-verified against their source documents, updated with
  `write_concept` (updating `sources` and advancing `stale_after`), and verified with `verify_concept`.

# Actors

Every mutation recorded by ok-fine requires an `actor` identifier. Desktop and web chat sessions record their harness
and model:

- `claude-desktop/<model>` (e.g. `claude-desktop/claude-opus-4-5`)
- `claude-ai/<model>` (e.g. `claude-ai/claude-opus-4-5`)
- `chatgpt/<model>` (e.g. `chatgpt/gpt-5`)

A `human:<email>` actor is used only when a human has directly reviewed the concept, and the email matches the
authenticated token's verified identity claim (see
[Authentication and authorization](https://github.com/ferrule-io/ok-fine/wiki/Authentication-and-Authorization)).
