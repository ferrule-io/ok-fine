Every change is a commit on `GIT_BRANCH`, for example
`okf(payments-api): update tables/orders`, authored by the actor.

# Remote security and repository protection

The git remote holding the knowledge repository **must be private**, with branch protection enabled on `main` (requiring pull request reviews). Because AI coding agents consume concept content as project knowledge, concept content is untrusted input. Protecting `main` and reviewing pull requests prevents unauthorized, prompt-injected, or malicious changes from entering agent context.

Symlinks pulled from the knowledge remote are never followed for reads or writes and are ignored by the storage layer.

# Sync loop

With `GIT_REMOTE_URL` set, ok-fine:

- clones from the remote on first start (and refuses to start if the remote is unreachable and nothing is local yet);
- before each write, fetches and rebases onto the remote; after each write, pushes (up to 3 attempts);
- syncs every `GIT_SYNC_INTERVAL_SECONDS` (0 disables the loop; `sync_now` still works).

On a rebase conflict, ok-fine does not discard local work:

1. It moves the local commits to a branch `ok-fine/conflict-<timestamp>` and pushes that branch to the remote.
2. It resets to the remote branch.
3. It reports the conflict in `GET /api/v1/sync` → `lastError`.

If a write conflicts with a concurrent upstream edit during push, the write fails with `upstream_conflict`;
re-read and retry.

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

- **SSH:** Configured via `GIT_SSH_KEY_PATH` and `GIT_SSH_KNOWN_HOSTS_PATH`. If `GIT_SSH_KNOWN_HOSTS_PATH` is set but the file is missing, startup fails immediately (preventing silent trust-on-first-use). The Helm chart requires a `known_hosts` entry in the secret for SSH authentication. Runtime SSH key copies are stored in the OS temp directory, never in `DATA_DIR`. Git error messages automatically redact remote URLs and commit messages to prevent credential leakage.
- **HTTPS:** Configured via `GIT_HTTP_USERNAME` / `GIT_HTTP_PASSWORD`, passed via environment, never written to git config.

The npm CLI (`ok-fine`, `ok-fine serve`) instead runs git with your own environment: your ssh-agent and
`~/.ssh/config`, and credential helpers such as osxkeychain or `gh auth setup-git`. git runs without a terminal, so
accept host keys and unlock keys beforehand (e.g. `git ls-remote <url>`). Your hooks and global ignore and
attributes files are not applied to the knowledge repository. See
[Running locally](https://github.com/ferrule-io/ok-fine/wiki/Running-Locally#syncing-with-a-git-remote).
