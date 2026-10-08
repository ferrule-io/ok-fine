A client only sees the tools its token's scopes allow. Over stdio, every tool is available.

| Tool | Scope | Purpose |
|---|---|---|
| `list_projects` | read | Projects with counts, bound git repositories, and routing metadata (`teams`, `domains`, `audience`, `keywords`, `owners`); call first to pick a project (pass `repository` in a git repo; or `team` and/or `query`, or no arguments) |
| `orient` | read | Call before answering any question about how the organization works: processes, policies, customers, products, campaigns (`question` max 512 chars, `limit` max 50); returns ranked projects, concepts, and working rules. The hub project (`HUB_PROJECT`) is always listed when it exists, also when `project` narrows the search |
| `get_index` | read | Directory listing: concepts by type, files, subdirectories |
| `read_concept` | read | Frontmatter, body, derived trust/staleness, links, lint issues (including `unresolved_conflict`), `revision` |
| `search_concepts` | read | Keyword search (`query` max 512 chars) with filters; omitting `project` searches every project and returns `project` for `read_concept` |
| `get_history` | read | Git history of a concept or project |
| `read_file` | read | Any text file verbatim (including `index.md`, `log.md`, assets) |
| `lint_project` | read | OKF conformance report, plus an `unresolved_conflict` warning per file of each unresolved conflict |
| `list_conflicts` | read | The project's unresolved conflicts: id, changed files (`change`, `divergent`), and the commits that made them |
| `read_conflict` | read | One file of a conflict: `preserved`, `base`, and `current` (with `revision`); null = absent on that side |
| `submit_feedback` | read | Prefilled public GitHub issue link for feedback about ok-fine; the user submits it |
| `create_project` | write | New bundle with `overview.md`, `log.md`, `index.md` |
| `write_concept` | write | Create or replace a concept (whole frontmatter and body) |
| `verify_concept` | write | Append a verification, raising the trust tier |
| `delete_concept` | write | Remove a concept |
| `write_file` | write | Create or replace a non-markdown asset |
| `delete_file` | write | Remove an asset |
| `resolve_conflict` | write | Discard this project's part of a conflict after merging; `paths` must list every file of the conflict |
| `delete_project` | admin | Remove a whole bundle (`confirm` must repeat the name) |
| `sync_now` | admin | Fetch, rebase, and push to the git remote now |

`search_concepts` hides `deprecated` concepts unless `status: "deprecated"` is requested. Omitting `project` searches across all projects. The `query` parameter is limited to 512 characters.

# Optimistic concurrency

`read_concept` returns a `revision` (git blob SHA). Pass it back as `expectedRevision`:

- omitted: unconditional
- a string: must match the current revision (`revision_conflict` with `details.currentRevision` otherwise);
  accepted by `write_concept`, `write_file`, `verify_concept`, `delete_concept`, and `delete_file`
- `null`: create-only, the target must not exist yet (`already_exists` otherwise); accepted by `write_concept`
  and `write_file` only

# Conflicts

Writes reach a concept through one server in order, so two sessions on the same server never conflict in git;
`expectedRevision` catches the overlap (only when the client passes it). Separate ok-fine instances sharing a git
remote can: when ok-fine cannot rebase its accepted writes onto the remote, it keeps them as a conflict for each
project they touch (see [Git storage](https://github.com/ferrule-io/ok-fine/wiki/Git-Storage-and-Remote-Sync)).

1. `lint_project`, or `read_concept` on an affected concept, reports `unresolved_conflict` with the conflict id.
2. `read_conflict` returns the `preserved` write, the common `base`, and the `current` content with its `revision`.
3. Write the merge with `write_concept`/`write_file` and `expectedRevision` set to that `revision`.
4. `resolve_conflict` with every file path of the conflict in `paths`. It fails with `bad_request`
   (`details.unacknowledged`) when a file is missing, and with `not_found` when the conflict was already resolved.
