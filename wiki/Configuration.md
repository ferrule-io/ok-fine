All configuration is via environment variables; the `ok-fine` npm CLI also takes flags for the common ones (see
[Running locally](https://github.com/ferrule-io/ok-fine/wiki/Running-Locally)). Invalid values stop startup with a
message naming every bad variable.

| Variable | Default | Description |
|---|---|---|
| `PUBLIC_BASE_URL` | **required** (container); `http://localhost:<PORT>` (`ok-fine serve`) | External URL, e.g. `https://okf.example.com`. Used in OAuth metadata. |
| `AUTH_MODE` | `oidc` | Authentication mode: `oidc` or `none` |
| `ALLOW_UNAUTHENTICATED_NETWORK` | `false` | When `AUTH_MODE=none`, allows startup on a non-loopback `HOST` (e.g. inside a container with `-p 127.0.0.1:...`) |
| `OAUTH_ISSUER` | required when `AUTH_MODE=oidc` | Must equal the token `iss` exactly (`oidc` mode only) |
| `OAUTH_AUDIENCE` | `<PUBLIC_BASE_URL>/mcp` | Comma-separated accepted audiences (`oidc` mode only) |
| `OAUTH_JWKS_URI` | discovered | Override the JWKS URL; must be `https://` unless `OAUTH_ALLOW_INSECURE_ISSUER=true` (`oidc` mode only) |
| `OAUTH_SCOPE_READ` / `_WRITE` / `_ADMIN` | `okf:read` / `okf:write` / `okf:admin` | Scope names (granted to anonymous principal in `none` mode) |
| `OAUTH_IDENTITY_CLAIMS` | `email,preferred_username,sub` | Claims tried in order for `human:<id>` binding; `email` is used only when `email_verified=true` (`oidc` mode only) |
| `OAUTH_ALLOWED_SUBJECTS` | unset | Comma-separated list of allowed JWT `sub` values (`oidc` mode only) |
| `OAUTH_ALLOWED_EMAILS` | unset | Comma-separated list of allowed emails, compared case-insensitively, requiring `email_verified=true` (`oidc` mode only) |
| `OAUTH_REQUIRED_GROUPS` | unset | Comma-separated list of required groups; token's groups claim must intersect (`oidc` mode only) |
| `OAUTH_GROUPS_CLAIM` | `groups` | Claim name to read for user groups (`oidc` mode only) |
| `OAUTH_ALLOWED_CLIENT_IDS` | unset | Comma-separated list of allowed client IDs matched against `azp`, `client_id`, or `cid` (`oidc` mode only) |
| `OAUTH_ALLOW_INSECURE_ISSUER` | `false` | Allow an `http://` issuer (development only, `oidc` mode only) |
| `TRUST_PROXY` | `loopback,linklocal,uniquelocal` | Fastify trustProxy setting (`true`, `false`, hop count, or comma-separated CIDRs/keywords); affects logged client IP/protocol only |
| `PORT` | `8080` | |
| `HOST` | `0.0.0.0` (container), `127.0.0.1` (`ok-fine serve`) | Loopback required when `AUTH_MODE=none` unless `ALLOW_UNAUTHENTICATED_NETWORK=true` |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent` |
| `DATA_DIR` | `/data` (container), `~/.ok-fine` (CLI) | Absolute path for the repo and working files |
| `GIT_BRANCH` | `main` | |
| `GIT_REMOTE_URL` | unset | SSH/HTTPS URL or local path; unset keeps history on disk only |
| `GIT_SYNC_INTERVAL_SECONDS` | `60` | Periodic sync; `0` disables |
| `GIT_SSH_KEY_PATH` | unset | Private key file |
| `GIT_SSH_KNOWN_HOSTS_PATH` | unset | `known_hosts` file; enables strict host checking. Startup fails if set but the file is missing (no silent trust-on-first-use) |
| `GIT_HTTP_USERNAME` / `GIT_HTTP_PASSWORD` | unset | Set both or neither |
| `MAX_FILE_BYTES` | `1048576` | Max size of one concept or file |
| `MAX_ARCHIVE_BYTES` | `52428800` | Max compressed archive upload |
| `DEFAULT_STALE_AFTER_DAYS` | unset | Opt-in; stamps `stale_after` = now + N days on `write_concept` when omitted; producer value wins |

Over stdio (`ok-fine` with no command), only `LOG_LEVEL`, `DATA_DIR`, `GIT_*`, `MAX_*`, and
`DEFAULT_STALE_AFTER_DAYS` apply. The CLI (stdio and `ok-fine serve`) runs git with your environment and
credentials; the container isolates git under `DATA_DIR/home`.
