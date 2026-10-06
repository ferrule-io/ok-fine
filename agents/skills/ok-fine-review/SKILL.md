---
name: ok-fine-review
description: "Review and maintain this repository's ok-fine knowledge: find non-conformant, stale, unverified, or drifted concepts, update or deprecate them, and record verification. Use when the user asks to review, audit, refresh, verify, or clean up ok-fine knowledge for this codebase."
---

# ok-fine-review

## 1. Resolve the projects
1. Determine the git remote URL:
   - Run `git remote get-url origin`.
   - If that fails, get the first remote name from `git remote` and run `git remote get-url <name>`.
   - If no remote exists, stop and report that ok-fine cannot identify the repository.
2. Call `list_projects` with `repository` set to the remote URL.
   - If the ok-fine tools are missing or return an authentication error, stop and report that the `ok-fine` MCP server is not connected.
   - If no project matches, report that the repository is not onboarded and suggest running the `ok-fine-onboard` skill. Stop.
3. Review every returned project: run steps 2–5 once per project, label findings with their project, and pass that `project` to every tool call.

## 2. Collect
1. Conformance:
   - Call `lint_project` with `project`.
   - Collect all errors, warnings, and info issues.
2. Staleness:
   - Call `search_concepts` with `project` and `stale: true`.
3. Unverified concepts:
   - Call `search_concepts` with `project`, `trustTier: "unverified"`, and `limit: 100`.
4. Concept drift:
   - For each concept whose `sources` array entries define a `commit` and a `resource` matching `<normalized repository>/<path>`:
     - Check file existence: run `git cat-file -e HEAD:<path>`. If this fails, the file has been moved or deleted.
     - Check commit changes: run `git log --oneline <commit>..HEAD -- <path>`. If output is non-empty, the file has changed since the source commit.
     - If the commit is absent in history (e.g. shallow clone), mark drift status as "unknown".

## 3. Present actions
1. Present findings in a markdown table:

| Concept | Issue | Proposed Action |
| --- | --- | --- |

2. Wait for user confirmation before applying modifications. If the user's initial prompt instructed to fix or update all issues, proceed directly without waiting.

## 4. Apply approved actions
1. Update:
   - Call `read_concept` with `project` and `id` to obtain the latest `revision`.
   - Update frontmatter and body: refresh the source `commit` to `git rev-parse HEAD`, extend `stale_after` by 180 days (ISO 8601 with offset), and update body content.
   - Call `write_concept` with `project`, `id`, `frontmatter`, `body`, `actor: <harness>/<model>`, `expectedRevision: <revision>`, and `message`.
2. Deprecate:
   - Call `read_concept` to get the latest `revision`.
   - Update frontmatter to set `status: deprecated`. Add a link in the body to the successor concept if available.
   - Call `write_concept` with `expectedRevision: <revision>`.
3. Delete:
   - Call `delete_concept` with `project`, `id`, `actor: <harness>/<model>`, and `expectedRevision: <revision>` only when explicitly requested by the user.

## 5. Verify
1. Agent verification (machine-confirmed):
   - Check the concept against the codebase to ensure complete accuracy.
   - Call `verify_concept` with `project`, `id`, `actor: <harness>/<model>`, and `expectedRevision: <revision>`.
2. Human verification (human-reviewed):
   - Use a `human:` actor only when the user explicitly confirms personal review of the concept.
   - Derive the actor as `human:<email>` from `git config user.email`. Do not ask the user for an identifier.
   - If `git config user.email` is empty, stop and report that human verification needs a git email.
   - If the server rejects the call with `forbidden_actor` (e.g. `this token may only act as human:<id>`), stop and report both values: the local git email and the token identity named in the error. Never retry as a different identity.

## 6. Report
1. Report all applied changes: updated concepts, deprecated concepts, deleted concepts, and recorded verifications.
2. Report any unresolved issues or concepts that require human attention.
