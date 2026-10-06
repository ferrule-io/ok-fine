A client only sees the tools its token's scopes allow. Over stdio, every tool is available.

| Tool | Scope | Purpose |
|---|---|---|
| `list_projects` | read | Projects with counts and bound git repositories; `repository` filters to one codebase |
| `get_index` | read | Directory listing: concepts by type, files, subdirectories |
| `read_concept` | read | Frontmatter, body, derived trust/staleness, links, lint issues, `revision` |
| `search_concepts` | read | Keyword search (`query` max 512 chars) with filters (`project`, `type`, `tags`, `status`, `trustTier`, `stale`) |
| `get_history` | read | Git history of a concept or project |
| `read_file` | read | Any text file verbatim (including `index.md`, `log.md`, assets) |
| `lint_project` | read | OKF conformance report |
| `submit_feedback` | read | Prefilled public GitHub issue link for feedback about ok-fine; the user submits it |
| `create_project` | write | New bundle with `overview.md`, `log.md`, `index.md` |
| `write_concept` | write | Create or replace a concept (whole frontmatter and body) |
| `verify_concept` | write | Append a verification, raising the trust tier |
| `delete_concept` | write | Remove a concept |
| `write_file` | write | Create or replace a non-markdown asset |
| `delete_file` | write | Remove an asset |
| `delete_project` | admin | Remove a whole bundle (`confirm` must repeat the name) |
| `sync_now` | admin | Fetch, rebase, and push to the git remote now |

`search_concepts` hides `deprecated` concepts unless `status: "deprecated"` is requested. The `query` parameter is limited to 512 characters.

# Optimistic concurrency

`read_concept` returns a `revision` (git blob SHA). Pass it back as `expectedRevision`:

- omitted: unconditional
- a string: must match the current revision (`revision_conflict` with `details.currentRevision` otherwise);
  accepted by `write_concept`, `write_file`, `verify_concept`, `delete_concept`, and `delete_file`
- `null`: create-only, the target must not exist yet (`already_exists` otherwise); accepted by `write_concept`
  and `write_file` only
