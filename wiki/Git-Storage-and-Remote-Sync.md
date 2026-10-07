Every change is a commit on `GIT_BRANCH`, for example
`okf(payments-api): update tables/orders`, authored by the actor.

# Remote security and repository protection

The git remote holding the knowledge repository **must be private**, with branch protection enabled on `main` (requiring pull request reviews). Because AI coding agents consume concept content as project knowledge, concept content is untrusted input. Protecting `main` and reviewing pull requests prevents unauthorized, prompt-injected, or malicious changes from entering agent context.

Symlinks pulled from the knowledge remote are never followed for reads or writes and are ignored by the storage layer.

### Allowed remote URL formats

When `GIT_REMOTE_URL` is configured, it must use one of the following formats:
- `https://…` (plaintext `http://` is rejected)
- `ssh://…`
- SCP-style SSH: `user@host:path` (contains `@` before `:`)
- `file://…` or an absolute local path (starting with `/`)

All other formats—including `http://`, `git://`, `ext::`, and relative paths—fail configuration validation at startup (`GIT_REMOTE_URL must be https://, ssh://, user@host:path, file:// or an absolute path`).

# Sync loop

With `GIT_REMOTE_URL` set, ok-fine:

- clones from the remote on first start (and refuses to start if the remote is unreachable and nothing is local yet);
- before each write, fetches and rebases onto the remote; after each write, pushes (up to 3 attempts);
- syncs every `GIT_SYNC_INTERVAL_SECONDS` (0 disables the loop; `sync_now` still works).

On a rebase conflict, ok-fine does not discard local work:

1. It keeps the local commits as one conflict per project they touch: a branch
   `ok-fine/conflict/<project>/<id>` per project, all pointing at the same commit, pushed to the remote when
   possible. `<id>` is `<UTC timestamp with milliseconds>-<12 hex of the commit>`.
2. It resets to the remote branch.
3. It reports the conflict in `GET /api/v1/sync` → `lastError`, and agents see it as an `unresolved_conflict`
   lint issue in the affected project only.

This happens during sync, before a write (the write then proceeds on the remote state), and when a write's push is
rejected and its rebase conflicts. In the last case the write fails with `upstream_conflict`; the write itself and
any earlier unpushed writes are in the conflict (`details.conflicts`).

Resolving a conflict (`resolve_conflict`) deletes only that project's branch, locally and on the remote; the commit
stays reachable while another project's branch still points at it. If the remote deletion fails, ok-fine retries it
on the next sync. See [MCP tools](https://github.com/ferrule-io/ok-fine/wiki/MCP-Tools#conflicts) for the agent
workflow. On start, ok-fine splits older `ok-fine/conflict-<timestamp>` branches into per-project conflicts; their
remote copies are left in place.

If the remote's history is rewritten (such as following a force-push), sync halts immediately — ok-fine will not rebase, push, or push a conflict branch. The sync status `lastError` (in `GET /api/v1/sync`) reports that the remote history was rewritten.

People can edit the remote directly, e.g. by opening pull requests against the knowledge repo. ok-fine picks up
the changes on the next sync and regenerates indexes. `.gitattributes` uses a union merge for `index.md` and
`log.md` to keep conflicts rare.

# Leak remediation runbook

Deleting a concept or file in ok-fine creates a commit removing the file from the tree, but the content remains in the remote git history. If a secret or sensitive information was committed to the knowledge repository, follow this procedure to completely purge it:

1. **Stop ok-fine:** Stop the `ok-fine` process or scale the deployment to 0 replicas (`kubectl scale deployment okf --replicas=0`).
2. **Rewrite remote history:** Use `git filter-repo` or BFG Repo-Cleaner on a local checkout to remove the secret or file from all commits and tags, then force-push the rewritten history to the remote.
3. **Delete local repo cache:** Delete the repository directory inside `DATA_DIR` (e.g. `rm -rf $DATA_DIR/repo`).
4. **Restart ok-fine:** Start the process or scale the deployment back to 1 replica (`kubectl scale deployment okf --replicas=1`). ok-fine will perform a fresh clone of the cleaned remote repository.

# Remote authentication

- **SSH:** Configured via `GIT_SSH_KEY_PATH` and `GIT_SSH_KNOWN_HOSTS_PATH`. Setting `GIT_SSH_KEY_PATH` requires `GIT_SSH_KNOWN_HOSTS_PATH` to also be set, and the `known_hosts` file must exist on disk; startup fails configuration validation otherwise. Strict host key checking is always enforced when an SSH key is configured. The Helm chart requires a `known_hosts` entry in the secret for SSH authentication. Runtime SSH key copies are stored in the OS temp directory, never in `DATA_DIR`. Git error messages automatically redact remote URLs and commit messages to prevent credential leakage.
- **HTTPS:** Configured via `GIT_HTTP_USERNAME` / `GIT_HTTP_PASSWORD`, passed via environment, never written to git config.

The npm CLI (`ok-fine`, `ok-fine serve`) instead runs git with your own environment: your ssh-agent and
`~/.ssh/config`, and credential helpers such as osxkeychain or `gh auth setup-git`. git runs without a terminal, so
accept host keys and unlock keys beforehand (e.g. `git ls-remote <url>`). Your hooks and global ignore and
attributes files are not applied to the knowledge repository. See
[Running locally](https://github.com/ferrule-io/ok-fine/wiki/Running-Locally#syncing-with-a-git-remote).
