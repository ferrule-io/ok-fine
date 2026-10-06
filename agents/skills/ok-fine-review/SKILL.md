---
name: ok-fine-review
description: "Review and maintain this repository's ok-fine knowledge: find non-conformant, stale, unverified, or drifted concepts, refresh and verify them autonomously, and propose deprecations or deletions for user confirmation. Use when the user asks to review, audit, refresh, verify, or clean up ok-fine knowledge for this codebase."
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
4. Concept drift and missing staleness:
   - For each concept whose `sources` array entries define a `commit` and a `resource` matching `<normalized repository>/<path>`:
     - Check file existence: run `git cat-file -e HEAD:<path>`. If this fails, the file has been moved or deleted (drifted).
     - Check commit changes: run `git log --oneline <commit>..HEAD -- <path>`. If output is non-empty, the file has changed since the source commit (drifted).
     - If the commit is absent in history (e.g. shallow clone), drift is unknown; treat as drifted (confirm against code).
   - Check frontmatter from `read_concept`: collect concepts missing `stale_after` as a finding needing update.

## 3. Present actions
1. Present findings in a markdown table as a report:

| Concept | Issue | Proposed Action |
| --- | --- | --- |

2. Apply refresh actions (update and verify) directly without waiting for user confirmation.
3. Reserve user confirmation for deprecations and deletions only (delete still only on explicit user request). If the user's initial prompt already instructed to fix or clean up everything, deprecations may proceed directly without waiting.

## 4. Apply actions
1. Update / Refresh (autonomous, no user confirmation needed):
   - Confirm the concept against current code; if wrong or drifted, fix the body.
   - Call `read_concept` with `project` and `id` to obtain the latest `revision`.
   - Update frontmatter:
     - Preserve all existing frontmatter fields, including unknown keys.
     - For each code source in `sources`, set `commit` to `git rev-parse HEAD` (drop or replace sources whose file has been moved or deleted).
     - Set `stale_after` to now + 180 days (ISO 8601 with explicit offset, e.g. `2027-04-03T00:00:00Z`). Concepts missing `stale_after` get it set. Volatile facts (versions, owners, endpoints, deploy targets) may use a shorter horizon (e.g. 90 days).
   - Call `write_concept` with `project`, `id`, `frontmatter`, `body`, `actor: <harness>/<model>`, `expectedRevision: <revision>`, and `message`.
   - Immediately follow with agent verification (see §5): call `verify_concept` with `project`, `id`, `actor: <harness>/<model>`, and `expectedRevision` set to the revision returned by `write_concept`.
2. Deprecate (requires user confirmation):
   - Apply only after user confirmation (unless the user's initial prompt already instructed to fix or clean up everything).
   - Call `read_concept` to get the latest `revision`.
   - Update frontmatter to set `status: deprecated`. Add a link in the body to the successor concept if available.
   - Call `write_concept` with `expectedRevision: <revision>`.
3. Delete (requires explicit user request):
   - Call `delete_concept` with `project`, `id`, `actor: <harness>/<model>`, and `expectedRevision: <revision>` only when explicitly requested by the user.

## 5. Verify
1. Agent verification (machine-confirmed):
   - Default step following refresh: always preceded by refreshing the concept (updating code source commits to `git rev-parse HEAD` and extending `stale_after` to now + 180 days).
   - Confirm the concept against the codebase to ensure complete accuracy.
   - Call `verify_concept` with `project`, `id`, `actor: <harness>/<model>`, and `expectedRevision` set to the revision returned by `write_concept`.
   - Never use `human:` actor for agent verification.
2. Human verification (human-reviewed):
   - Optional correction step: use a `human:` actor only when the user explicitly confirms personal review of the concept.
   - Derive the actor as `human:<email>` from `git config user.email`. Do not ask the user for an identifier.
   - If `git config user.email` is empty, stop and report that human verification needs a git email.
   - If the server rejects the call with `forbidden_actor` (e.g. `this token may only act as human:<id>`), stop and report both values: the local git email and the token identity named in the error. Never retry as a different identity.

## 6. Report
1. Report all applied changes: refreshed and verified concepts (including updated source commit hashes and extended `stale_after`), and any recorded human verifications.
2. Report any deprecation or deletion proposals awaiting user confirmation.
3. Report any unresolved issues or concepts that require human attention.
