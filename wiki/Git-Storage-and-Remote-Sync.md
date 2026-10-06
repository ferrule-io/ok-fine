Every change is a commit on `GIT_BRANCH`, for example
`okf(payments-api): update tables/orders`, authored by the actor.

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

People can edit the remote directly, e.g. by opening pull requests against the knowledge repo. ok-fine picks up
the changes on the next sync and regenerates indexes. `.gitattributes` uses a union merge for `index.md` and
`log.md` to keep conflicts rare.

Remote auth: SSH (`GIT_SSH_KEY_PATH`, optional `GIT_SSH_KNOWN_HOSTS_PATH`; without it the host key is trusted on
first use) or HTTPS (`GIT_HTTP_USERNAME` / `GIT_HTTP_PASSWORD`, passed via environment, never written to git config).

The npm CLI (`ok-fine`, `ok-fine serve`) instead runs git with your own environment: your ssh-agent and
`~/.ssh/config`, and credential helpers such as osxkeychain or `gh auth setup-git`. git runs without a terminal, so
accept host keys and unlock keys beforehand (e.g. `git ls-remote <url>`). Your hooks and global ignore and
attributes files are not applied to the knowledge repository. See
[Running locally](https://github.com/ferrule-io/ok-fine/wiki/Running-Locally#syncing-with-a-git-remote).
