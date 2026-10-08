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

# Onboarding a team

For non-coding teams (such as support, sales, marketing, and operations) using Claude Desktop, claude.ai, or ChatGPT with the ok-fine skills installed, onboarding is conversational and user-initiated only. Outside a git repository, an agent never says "not onboarded" or offers onboarding unasked. To start, the user asks to onboard a team (for example, "onboard the support team to ok-fine"); the `ok-fine-onboard` skill then runs the interview.

## Recommended organization layout

- **Hub project (`org`):** A shared hub holding company-wide policies, a common glossary, and the team and owner directory.
- **Team projects:** One project per team (e.g. `support`, `sales`, `marketing`) holding team-specific playbooks, processes, FAQs, templates, and domain knowledge.
- **Process projects:** A separate process project only when several teams genuinely share a single cross-functional process.
- **Project identifiers:** Project names must match `^[a-z0-9][a-z0-9-]{0,62}$`.

## The onboarding interview

The `ok-fine-onboard` skill walks through six steps:

1. **Team and audience:** Identify which team owns the project and who will consume this knowledge.
2. **Top recurring questions and tasks:** Gather the top 5 recurring questions or tasks the team handles.
3. **Existing documentation:** Collect existing documents, links (Google Docs, Notion pages, Zendesk macros, Slack permalinks), or pasted text.
4. **Create and bind project:** Create the project with `create_project` (which takes only `project`, `title`, `description`, and `actor`). Then call `read_concept` on the generated overview concept and `write_concept` it (passing `expectedRevision`) to set `stale_after` and add binding fields as plain overview frontmatter keys:
   - `teams`: string list of team names
   - `domains`: string list of functional domains
   - `audience`: string list of target roles
   - `keywords`: string list of key search terms
   - `owners`: list of team or role aliases (e.g. `support-leads`), never an individual's name or email

   These names match planned [issue #35](https://github.com/ferrule-io/ok-fine/issues/35), where the server will expose and filter on them; until then, they are plain frontmatter keys preserved by the server.
5. **Seed initial concepts:** Seed 5–12 concepts as `status: draft`, mapped from the recurring questions, tasks, and documents.
6. **Owner walk-through and verification:** Go through each seeded concept with the owner. For each concept the owner confirms (optionally after edits):
   - Set `status: stable` via `write_concept` (with `expectedRevision`); confirmation alone does not change `status`.
   - Call `verify_concept` with `actor: human:<email>`.

   The server requires `human:<email>` to equal the authenticated token identity, so this works only when the owner is the person in the session (ask the user for their email, as there is no git config outside a repository). On `forbidden_actor`, report both identities and leave the concept for the owner to verify in their own session; never retry as another actor.

## Business concept types

| Type | Id prefix | `stale_after` |
|---|---|---|
| Playbook | `playbooks/` | 90–180d |
| Policy | `policies/` | 180–365d |
| Process | `processes/` | 180d |
| Escalation | `escalations/` | 90–180d |
| FAQ | `faqs/` | 90–180d |
| Campaign | `campaigns/` | 30–90d |
| Persona / Product | `personas/`, `products/` | 90–180d |
| Template | `templates/` | 180d |
| Glossary Term / Decision | `glossary/`, `decisions/` | 365d / 180d |

*Note:* Coding projects keep `runbooks/<slug>` for engineering Playbooks; business Playbooks use `playbooks/<slug>`.

## The recording loop

Knowledge capture continues during regular work. When a customer support representative resolves a new kind of case, or a campaign closes, the agent proposes (asking the user before writing) a draft FAQ, Escalation, or Playbook concept (`status: draft`). The agent searches existing knowledge first using `search_concepts` to update an existing concept instead of duplicating.

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
  and is not in the past. Timestamps for `stale_after` and `last_modified` must use ISO 8601 with an explicit offset (e.g. `2026-09-30T14:00:00Z`); lint warns if the offset is omitted.
- **Non-code sources:** Non-code sources carry `title`, `author`, `last_modified`, and no `commit`. The `resource` property is a URL (such as a Google Doc, Notion page, Zendesk macro, or Slack permalink) or a stable URI.
  - *Canonical URLs:* Server lint warns (`invalid_resource`) when `resource` contains whitespace or any shell metacharacters (`` ` $ ; | & < > ( ) \ ' " ``). The warning is accepted for canonical URLs containing `&` (such as Slack thread permalinks); agents record URLs exactly as shared and never rewrite or re-encode them.
  - *Pasted text:* When documents are pasted without an existing URL, use a stable URI such as `urn:ok-fine:pasted:<slug>` with `title` and `author`.
  - *Dates:* URL sources require `last_modified`, taken from the document or its owner, never the time it was read; a URL whose date nobody knows is not cited until it is known. Pasted text carries `last_modified` only when its date is stated.
  - *Footnote citations:* Footnote citations `[^id]` in concept text must correspond to a source `id`; lint warns if a footnote matches no source id.
  - *Privacy and secrets:* Never record personal data (customer or employee names, emails, phone numbers) or secrets; `owners` on the overview and `author` in sources hold team or role names only.
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
