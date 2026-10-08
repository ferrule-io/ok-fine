---
name: ok-fine-onboard
description: "Onboard a git repository or a team to ok-fine: create or choose its ok-fine project, bind a repository's git remote or a team's metadata to it, and bootstrap initial knowledge from code or a conversational interview. Use when the user asks to onboard, connect, bind, or set up this repository with ok-fine; when the user agrees to onboard after ok-fine reports the repository is not onboarded; or when the user asks to onboard or set up a team, department, or non-coding knowledge area in ok-fine (e.g. 'set up ok-fine for the support team') from desktop or chat sessions without a repository. Never modifies files in the repository."
---

# ok-fine-onboard

## 1. Preconditions
1. Verify connectivity to ok-fine:
   - Call `list_projects`.
   - If the tool is missing or returns an error, stop and report that the `ok-fine` MCP server is not connected.
2. Determine the onboarding mode:
   - **Repository mode**: Use when the session is inside a git working tree with a remote, and the user asks to onboard a repository or codebase (or agrees after ok-fine reports the repository is not onboarded).
     - Run `git remote get-url origin`.
     - If that fails, get the first remote name from `git remote` and run `git remote get-url <name>`.
     - If no remote exists, stop and inform the user that a git remote URL is required to onboard a repository to ok-fine.
     - Follow §2 through §8.
   - **Team mode**: Use when there is no repository, no shell, or no remote, or when the user asks to onboard a team, department, or non-coding knowledge area rather than a codebase.
     - Never run git commands outside a repository.
     - Never offer onboarding unasked outside a repository (team onboarding is user-initiated only).
     - Follow §9 Team mode.

## 2. Already bound
1. Call `list_projects` with `repository` set to the remote URL.
2. If the returned `projects` array is non-empty:
   - Report the matching project(s) to the user.
   - Suggest running the `ok-fine-review` skill to audit or refresh knowledge.
   - Stop; do not re-onboard.

## 3. Choose the project
1. Derive the proposed project name:
   - Extract the last path segment of the normalized repository (the `repositories` value `list_projects` reports, e.g. `shop` from `github.com/acme/shop`).
   - Convert to lowercase, replace any sequence of characters outside `[a-z0-9-]` with `-`, trim leading and trailing `-`, and truncate to 63 characters.
   - Verify the name matches `^[a-z0-9][a-z0-9-]{0,62}$`.
2. Call `list_projects` without parameters to inspect existing project titles.
3. If the user's prompt specified the project name or specified whether to create a new project or bind to an existing one, proceed directly.
4. Otherwise, present the existing project titles and ask the user whether to create a new project `<name>` or bind this repository to an existing project (e.g. for monorepos or multi-repo products).

## 4. Create
1. If creating a new project:
   - Call `create_project` with:
     - `project`: `<name>`
     - `title`: repository name
     - `description`: first sentence of the repository README (omit if unavailable)
     - `actor`: `<harness>/<model>`
2. Error handling:
   - On `already_exists`, inform the user and ask whether to bind to that existing project.
   - On `forbidden` or insufficient scope error, stop and inform the user that the token requires the `okf:write` scope.

## 5. Bind
1. Read the project overview:
   - Call `read_concept` with `project: <project>` and `id: "overview"`.
   - Capture the current `frontmatter` and `revision`.
2. Update the overview to bind the remote URL:
   - Prepare `repositories` from the existing frontmatter value: a string becomes a one-element list, a list keeps its string items, and an absent value becomes an empty list. Append the remote URL exactly as output by git, removing any `user:password@` credentials, unless the list already contains it.
   - Call `write_concept` with:
     - `project`: `<project>`
     - `id`: `"overview"`
     - `frontmatter`: retain all existing frontmatter keys, updating `repositories`.
     - `body`: retain the existing body.
     - `actor`: `<harness>/<model>`
     - `expectedRevision`: the revision from `read_concept`.
     - `message`: `"Bind repository <remote-url>"`
3. Verify the binding:
   - Call `list_projects` with `repository` set to the remote URL.
   - Confirm the project appears in the returned list.

## 6. Bootstrap
Read repository files to extract project context. Never create or edit files in the repository.

1. Inspect relevant repository sources:
   - `README` / `README.md`
   - Documentation in `docs/`
   - Architecture Decision Records (e.g. `docs/adr/`, `adr/`)
   - Guidelines: `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `CONTRIBUTING.md`
   - Package manifests: `package.json`, `Cargo.toml`, `go.mod`, `pom.xml`, etc.
   - CI workflows: `.github/workflows/`, `.gitlab-ci.yml`, etc.
   - Deploy configs: `Dockerfile`, `docker-compose.yml`, Helm charts, Kubernetes manifests, Terraform, etc.
   - Top-level directories, entry points, test suites
   - Recent commit log: `git log --oneline -200`
2. Write initial concepts in the following order:
   - Pass `expectedRevision: null` (except for `overview`, where `expectedRevision` is passed).
   - Pass `actor: <harness>/<model>`.
   - Set `stale_after` = now + 180 days (ISO 8601 with explicit offset, e.g. `2027-04-03T00:00:00Z`) on every concept written (including the `overview` update in this step).
   - Include `sources` with `id`, `resource` (`<normalized repository>/<path>`), and `commit` (`git rev-parse HEAD`).
   - Use `status: draft` unless a source explicitly confirms the fact.
   - Never record secrets, tokens, credentials, or personal data.
   - Ordered sequence:
     1. `overview`: rewrite body with purpose, users, stack, layout, and how to build/test/run with links to runbooks.
     2. `architecture/system`: system architecture and overall flow.
     3. `architecture/<component>`: key components (maximum 8).
     4. `conventions/<slug>`: conventions evidenced by configs or guides (maximum 6).
     5. `runbooks/build-and-test`, `runbooks/run-locally`, and `runbooks/release` (release only if evidenced).
     6. `interfaces/<slug>`: external APIs, contracts, or schemas (maximum 6).
     7. `decisions/<slug>`: decisions backed by explicit evidence (ADRs, design docs, commit logs; set `status: stable` if sourced from an ADR).
     8. `glossary/<term>`: domain terminology (maximum 10).
3. Enforce the hard cap: maximum 30 concepts total. Prefer fewer, high-value concepts.

## 7. Lint
1. Call `lint_project` with `project: <project>`.
2. Fix all reported errors and warnings in the concepts created during bootstrapping by updating them with `write_concept` and their latest `expectedRevision`.

## 8. Report
1. Present a summary of created concepts grouped by type.
2. Note any skipped topics or components and the reasons.
3. Highlight key concepts recommended for human review (suggest running `ok-fine-review`).
4. In repository mode, confirm explicitly that no files in the codebase were created or modified. In Team mode, confirm explicitly that nothing was written outside ok-fine.

## 9. Team mode: onboarding interview

Team mode is a conversational interview for onboarding a team, department, or non-coding knowledge area (e.g. support, sales, marketing, operations) into ok-fine.
- **User-initiated only**: Run team onboarding only when the user explicitly asks to onboard, set up, or connect a team. Never offer onboarding unasked in desktop or chat sessions outside a repository (per the ok-fine skill §2).
- **No git commands**: Never run git commands outside a repository.
- **Actor format**: Outside repositories, pass `actor` as `<harness>/<model>` (e.g. `claude-desktop/<model>`, `claude-ai/<model>`, `chatgpt/<model>`).
- **Conversational flow**: Ask questions one or a few at a time conversationally, rather than dumping all questions at once.

### Recommended layout
Consult this layout when choosing or creating projects:
- **Hub project (`org`)**: Shared company-wide knowledge: company policies, org-wide glossary terms, and the team/owner directory. Org-wide glossary terms and company policies go to `org`, not team projects.
- **Team projects**: One project per team named after the team's short name (e.g. `support` for "Customer Support", `sales`, `marketing`, `finance`, `legal`) for team-specific playbooks, escalations, FAQs, personas, and templates.
- **Process projects**: A dedicated cross-functional project only when several teams genuinely share ownership of a single complex process (e.g. `procurement`, `incident-response`).
- **Project naming**: Names must match `^[a-z0-9][a-z0-9-]{0,62}$` (lowercase alphanumeric and hyphens, up to 63 characters).

### Interview steps

#### Step 1: Team and audience
1. Ask the user:
   - Which team is this for, and who uses this knowledge?
   - Who owns or maintains this knowledge? Record owners as team or role aliases (e.g. `support-leads`, `head-of-support`), never an individual's name or email. A person's email is used only transiently for `verify_concept` in Step 6.

#### Step 2: Top recurring questions and tasks
1. Ask the user:
   - What are the top 5 recurring questions or tasks handled by this team?

#### Step 3: Existing documentation
1. Ask the user:
   - What documents exist already? Invite the user to paste text or provide links (Google Docs, Notion pages, Zendesk macros, intranet pages, Slack permalinks, etc.).

#### Step 4: Choose or create project and bind metadata
1. Check existing projects:
   - Inspect existing projects, reusing the `list_projects` result from §1 connectivity check instead of calling again, unless time has passed.
   - Check existing projects against the Recommended layout. Suggest binding to an existing team project or the `org` hub instead of duplicating if one already fits.
2. If creating a new project:
   - Derive the project name from the team's short name as used in the Recommended layout (e.g. `support` for "Customer Support", `sales`, `marketing`), confirm it with the user, then apply the slug rules from §3 (lowercase, replace any sequence outside `[a-z0-9-]` with `-`, trim leading and trailing `-`, truncate to 63 characters, matching `^[a-z0-9][a-z0-9-]{0,62}$`).
   - Call `create_project` with:
     - `project`: `<name>`
     - `title`: team name (e.g. `"Customer Support"`)
     - `description`: brief description of the team's scope and purpose
     - `actor`: `<harness>/<model>`
   - Note: `create_project` takes only `project`, `title`, `description`, `actor`. Binding metadata is added in the next step.
   - On `already_exists`, inform the user and ask whether to bind to that existing project.
   - On `forbidden`, stop and inform the user that the token requires the `okf:write` scope.
3. Bind metadata to overview:
   - Call `read_concept` with `project: <project>` and `id: "overview"`.
   - Capture the current `frontmatter` and `revision`.
   - Update frontmatter by adding binding fields as plain keys (preserving all existing frontmatter keys):
     - `teams`: string list holding that same short team name (e.g. `["support"]`), optionally plus aliases
     - `domains`: string list (e.g. `["billing", "account-access"]`)
     - `audience`: string list (e.g. `["support-agents", "tier-1"]`)
     - `keywords`: string list of relevant search terms
     - `owners`: list of team or role aliases (from Step 1)
     - `stale_after`: now + 180 days (ISO 8601 with explicit offset, e.g. `2027-04-03T00:00:00Z`)
   - Call `write_concept` with:
     - `project`: `<project>`
     - `id`: `"overview"`
     - `frontmatter`: updated frontmatter with binding keys and `stale_after`.
     - `body`: team purpose, audience, and the top questions or tasks from Step 2 (links to seeded concepts are added after Step 5).
     - `actor`: `<harness>/<model>`
     - `expectedRevision`: the revision from `read_concept`.
     - `message`: `"Set overview and binding metadata for <team>"`

#### Step 5: Seed concepts
1. Map initial concepts from the top questions, tasks, and provided documents.
   - Seed between 5 and 12 concepts as `status: draft`. If the answers and documents support fewer than 5 concepts, ask follow-up questions (more recurring tasks, more documents) before seeding; if still fewer, seed only what is supported and say so in the report. Never invent or pad.
   - Enforce the hard cap: maximum 12 concepts total. Prefer fewer, high-value concepts.
   - Never invent facts not given by the user or their documents (gaps become questions for the user or owner, not invented content).
2. Business concept types (templates and structural conventions are in the `ok-fine` skill's `references/concepts.md`):

| Type | Id prefix | `stale_after` | Description & usage |
|---|---|---|---|
| Playbook | `playbooks/` | 90–180d | Step-by-step operational workflows (e.g. `playbooks/process-refund`). Business Playbooks use `playbooks/<slug>`; coding projects keep `runbooks/<slug>`. |
| Policy | `policies/` | 180–365d | Rules, compliance, and boundaries (e.g. `policies/refund-window`). Org-wide policies belong in `org`. |
| Process | `processes/` | 180d | Cross-functional lifecycles or multi-stage workflows. |
| Escalation | `escalations/` | 90–180d | Routing, criteria, and contacts when standard tier cannot resolve. |
| FAQ | `faqs/` | 90–180d | Direct answers to recurring questions. |
| Campaign | `campaigns/` | 30–90d | Time-bounded marketing/sales initiatives and messaging. |
| Persona | `personas/` | 90–180d | Target customer or user profiles and pain points. |
| Product | `products/` | 90–180d | Product or service capabilities, tiers, and limits. |
| Template | `templates/` | 180d | Standard response text, canned replies, email templates. |
| Glossary Term | `glossary/` | 365d | Domain terminology. Org-wide terms belong in `org`. |
| Decision | `decisions/` | 180d | Enduring business or operational decisions. |

3. Non-code sources rules:
   - For web and document sources: `resource` = URL (Google Doc, Notion page, Zendesk macro, Slack permalink, etc.), plus `title`, `author` (the owning team or role, e.g. `Finance Team`), `last_modified` (from document metadata or the date the user gives; ISO 8601 with explicit offset, e.g. `2026-09-30T14:00:00Z`), and omit `commit`. All three are required for a URL source: if the date is unknown, ask the user; if nobody knows, do not cite that URL yet (seed the concept only from other dated sources, or defer it) and list it as pending in the report. Never substitute the time you read or received the document.
   - URLs: record the URL exactly as shared; never rewrite, re-encode, or strip parameters, which can change what it points to. Server lint warns (`invalid_resource`) when `resource` contains whitespace or any of `` ` $ ; | & < > ( ) \ ' " ``; a canonical URL containing `&` (e.g. a Slack thread permalink) keeps that warning.
   - Pasted text with no URL: use a stable URI like `urn:ok-fine:pasted:<slug>` with `title` and `author`, plus `last_modified` only when the text or the user states its date.
   - Timezone offsets: `last_modified` (when present) and `stale_after` must include an explicit offset (e.g. `Z` or `+00:00`).
   - Source citations: all factual claims must cite sources with footnotes `[^id]` matching a source `id`. Lint warns if a footnote matches no source id.
   - Privacy and confidentiality: never record personal data (customer or employee names, emails, phone numbers) or secrets; `owners` and `author` hold team or role names only.
4. Concept fields for each seeded concept:
   - `type`: one of the business concept types above.
   - `title`: descriptive concept title.
   - `description`: one-sentence summary.
   - `status`: `draft`.
   - `tags`: relevant string tags.
   - `stale_after`: ISO 8601 timestamp with explicit offset per the type horizon above.
   - `sources`: non-code sources per rules above.
   - Write via `write_concept` with `project: <project>`, `id: <id>`, `expectedRevision: null`, and `actor: <harness>/<model>`.
5. Link the seeded concepts from the overview:
   - Call `read_concept` with `project: <project>` and `id: "overview"`, then `write_concept` with all frontmatter preserved, the body extended with bundle-absolute links to each seeded concept (e.g. `[Refund window](/policies/refund-window.md)`), and `expectedRevision`.
6. Lint:
   - Call `lint_project` with `project: <project>`.
   - Fix all reported errors and warnings in created concepts by updating them with `write_concept` and their latest `expectedRevision`, except `invalid_resource` on a canonical URL, which stays as recorded.

#### Step 6: Owner walk-through and report
1. Ask the user once for their email address (there is no git config outside a repository), then walk through each seeded concept with the owner conversationally:
   - Review each concept's title, description, and content with the owner.
   - For each concept the owner confirms (optionally after making requested edits):
     - Confirmation alone does not change `status`: `verified` survives later writes, so keep the order: set `status: stable` via `write_concept` (with `expectedRevision`) for owner-confirmed concepts, then verify.
     - Call `verify_concept` with `project: <project>`, `id: <id>`, `actor: human:<email>`, and `expectedRevision` set to the revision returned by `write_concept`.
     - The server requires `human:<email>` to equal the authenticated token identity, so this works only when the owner is the person in the current session.
     - On `forbidden_actor`: report the attempted `human:<email>` and the identity the server reports (it may be none, e.g. a token without an identity claim) to the user and leave the concept for the owner to verify in their own session. Never retry as another actor.
   - Concepts not confirmed by the owner remain `status: draft`.
2. Report:
   - Present a summary of created concepts grouped by type.
   - List concepts in three groups: owner-confirmed and verified (`human:` recorded), owner-confirmed but verification pending (forbidden_actor; owner must run `verify_concept` in their own session), and still `draft`.
   - If fewer than 5 concepts were seeded because answers and documents did not support more, state that in the report.
   - Confirm explicitly that nothing was written outside ok-fine (no files were created or modified on disk).
3. Next steps:
   - **Harness configuration**: Suggest adding the project to Claude Project instructions, Custom GPT instructions, or agent system prompts (e.g. `"Use ok-fine with project '<project>' for team knowledge"`).
   - **Audits and maintenance**: Suggest running the `ok-fine-review` skill periodically to audit, refresh, or clean up team knowledge.
   - **Recording loop**: When a team member resolves a new kind of case or a campaign closes, propose a draft FAQ, Escalation, or Playbook concept (`status: draft`), searching first to update an existing concept instead of duplicating.
