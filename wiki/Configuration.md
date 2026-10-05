All configuration is via environment variables. Invalid values stop startup with a message naming every bad
variable.

| Variable | Default | Description |
|---|---|---|
| `PUBLIC_BASE_URL` | **required** | External URL, e.g. `https://okf.example.com`. Used in OAuth metadata. |
| `AUTH_MODE` | `oidc` | Authentication mode: `oidc` or `none` |
| `OAUTH_ISSUER` | required when `AUTH_MODE=oidc` | Must equal the token `iss` exactly (`oidc` mode only) |
| `OAUTH_AUDIENCE` | `<PUBLIC_BASE_URL>/mcp` | Comma-separated accepted audiences (`oidc` mode only) |
| `OAUTH_JWKS_URI` | discovered | Override the JWKS URL (`oidc` mode only) |
| `OAUTH_SCOPE_READ` / `_WRITE` / `_ADMIN` | `okf:read` / `okf:write` / `okf:admin` | Scope names (granted to anonymous principal in `none` mode) |
| `OAUTH_IDENTITY_CLAIMS` | `preferred_username,email,sub` | Claims tried in order for `human:<id>` binding (`oidc` mode only) |
| `OAUTH_ALLOW_INSECURE_ISSUER` | `false` | Allow an `http://` issuer (development only, `oidc` mode only) |
| `PORT` | `8080` | |
| `HOST` | `0.0.0.0` | |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent` |
| `DATA_DIR` | `/data` | Absolute path for the repo and working files |
| `GIT_BRANCH` | `main` | |
| `GIT_REMOTE_URL` | unset | SSH/HTTPS URL or local path; unset keeps history on disk only |
| `GIT_SYNC_INTERVAL_SECONDS` | `60` | Periodic sync; `0` disables |
| `GIT_SSH_KEY_PATH` | unset | Private key file |
| `GIT_SSH_KNOWN_HOSTS_PATH` | unset | `known_hosts` file; enables strict host checking when present |
| `GIT_HTTP_USERNAME` / `GIT_HTTP_PASSWORD` | unset | Set both or neither |
| `MAX_FILE_BYTES` | `1048576` | Max size of one concept or file |
| `MAX_ARCHIVE_BYTES` | `52428800` | Max compressed archive upload |
