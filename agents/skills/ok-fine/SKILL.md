---
name: ok-fine
description: "Shared project knowledge for the current codebase, stored in the ok-fine MCP server rather than in the repository. Use at the start of any non-trivial task in a git repository to find, read, and keep fresh that repository's ok-fine project (architecture, decisions, conventions, runbooks), whenever the user asks what is known or was decided about this codebase, and before finishing a task to record durable knowledge you learned."
---

# ok-fine

## 1. Rule
Knowledge lives in ok-fine, never in repository files. Never write `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, or repository documentation files as a substitute.

## 2. Find the project
1. Resolve the git remote URL:
   - Run `git remote get-url origin`.
   - If that fails, get the first remote name from `git remote` and run `git remote get-url <name>`.
2. If no remote exists, state that ok-fine cannot identify the repository and continue the session without ok-fine.
3. Call `list_projects` with `repository` set to the remote URL. Read from every returned project. Write to the first returned project unless the user specifies another.
4. If no project matches, state once that the repository is not onboarded and offer the `ok-fine-onboard` skill. Never create projects unasked.
5. If ok-fine tools are missing or return an authentication error, state once that the `ok-fine` MCP server is not connected and continue without it.

## 3. Recall before working
1. Call `read_concept` with `project` and `id: "overview"`.
2. Call `get_index` with `project` to inspect the root directory index.
3. Call `search_concepts` with `project` and `query` set to key terms from the task. Read relevant matching concepts with `read_concept`.
4. Run drift check on every concept read: for each `sources` entry with a `commit` and a `resource` matching `<normalized repository>/<path>` (normalized repository is the `repositories` value from `list_projects`, e.g. `github.com/acme/shop`):
   - `git cat-file -e HEAD:<path>` fails → source moved or deleted (drifted).
   - `git log --oneline <commit>..HEAD -- <path>` non-empty → source changed (drifted).
   - Commit missing from local history (e.g. shallow clone) → drift unknown; treat as drifted (confirm against code).
   A concept is fresh when not `stale` (not past `stale_after`) and has no drifted sources.
5. Follow recall ordering:
   - Fresh, non-drifted concepts first; within those, trust tier (human-reviewed > machine-confirmed > unverified) as tiebreaker.
   - Stale or drifted concepts: check against code and refresh regardless of trust tier.
   - Deprecated concepts: historical context only.
6. When code contradicts a concept, trust the code. Complete the task using the code as source of truth.
7. Refresh stale or drifted concepts relied on for the task without asking the user (whether or not the body needed changes):
   - Confirm against current code; if wrong, fix the body.
   - Call `read_concept` to get the latest `revision`.
   - Call `write_concept` with all existing frontmatter preserved (including unknown keys), every code source's `commit` set to `git rev-parse HEAD` (drop or replace sources whose file is gone), `stale_after` set to now + 180 days (ISO 8601 with explicit offset, e.g. `2027-04-03T00:00:00Z`), and `expectedRevision`.
   - Call `verify_concept` with `actor: <harness>/<model>` and `expectedRevision` set to the revision returned by `write_concept`. (Never use `human:` for agent verifications.)

## 4. Record after working
Before completing a non-trivial task, record durable knowledge discovered or decided during work.

| Knowledge | `type` | Id prefix |
| --- | --- | --- |
| Decision with rationale and rejected alternatives | Decision | `decisions/<slug>` |
| Convention not enforced by tooling | Convention | `conventions/<slug>` |
| System structure / data flow | Architecture | `architecture/system` |
| Major module or service | Component | `architecture/<slug>` |
| Build, test, run, release, debug, recover | Playbook | `runbooks/<slug>` |
| API, CLI, schema, or event contract | Interface | `interfaces/<slug>` |
| Gotcha, incident, or external quirk | Reference | `notes/<slug>` |
| Domain term | Glossary Term | `glossary/<term>` |

Never record:
- Anything obvious from a minute of reading code
- Task progress or transient work notes
- Secrets, credentials, tokens, or personal data
- Code snippets longer than 5 lines

Search before creating (`search_concepts` with `project` and `query`) to update existing concepts instead of duplicating. Use lowercase kebab-case for slugs. Templates are in `references/concepts.md`.

## 5. Writing rules
1. Update existing concepts:
   - Call `read_concept` with `project` and `id`.
   - Pass the returned `revision` as `expectedRevision` to `write_concept`.
   - Preserve all existing frontmatter fields, including unknown keys.
2. Create new concepts:
   - Call `write_concept` with `expectedRevision: null`.
   - On `revision_conflict`, re-read the concept, merge changes, and retry once.
3. Frontmatter fields:
   - Set `type`, `title`, one-sentence `description`, `tags`, and `status`.
   - Use `status: draft` when knowledge is inferred rather than explicitly stated by a source.
   - Set `stale_after` on every concept you write (create or update) to now + 180 days (ISO 8601 timestamp with explicit offset, e.g. `2027-04-03T00:00:00Z`). Volatile facts (versions, owners, endpoints, deploy targets) may use a shorter horizon (e.g. 90 days).
4. Sources:
   - Provide a `sources` array where each entry has a short slug `id`.
   - Code evidence: `resource` = `<normalized repository>/<path>` (normalized repository is the `repositories` value from `list_projects`, e.g. `github.com/acme/shop`), and `commit` = full commit hash from `git rev-parse HEAD`.
   - Web evidence: `resource` = URL.
5. Citations and links:
   - Cite claims using footnotes `[^<id>]` matching the source `id`.
   - Link related concepts using bundle-absolute paths, e.g. `[Orders](/architecture/orders.md)`.
6. Actor:
   - Pass `actor` as `<harness>/<model>` (e.g. `claude-code/claude-opus-4-5`, `codex/gpt-5-codex`, `gemini-cli/gemini-2.5-pro`, `pi/claude-3-7-sonnet`, `omp/gemini-2.5-pro`).
   - Replace any characters outside `A-Za-z0-9._:+-` with `-`.
   - If model is unavailable, pass `<harness>/unknown`. Never use `human:<id>` for agent writes.
7. Verification:
   - After confirming a concept against current code (HEAD), an agent verification must refresh `sources[].commit` (to `git rev-parse HEAD`) and `stale_after` (to now + 180 days) first via `write_concept`, then call `verify_concept` with `actor: <harness>/<model>` and the returned `revision`, so the drift check stops firing.
8. Message:
   - Pass a concise one-line `message` describing the edit.
9. Deletion and deprecation:
   - Never write `index.md` or `log.md` (maintained by server).
   - Prefer deprecation (`status: deprecated` plus a successor link) over deletion.
   - Only deletions and deprecations require explicit user confirmation. Call `delete_concept` with `project`, `id`, `actor`, and `expectedRevision` only on explicit user request.
10. Inform the user which concepts changed.
