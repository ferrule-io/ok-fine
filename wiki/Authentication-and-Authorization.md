ok-fine supports three authentication modes configured via `AUTH_MODE`:

- **`oidc` (default):** ok-fine acts as an OAuth 2.1 **resource server only**. It issues no tokens; it validates JWT
  access tokens from any OIDC / RFC 8414 provider (Keycloak, Auth0, Okta, Zitadel, …). Static API keys can optionally be enabled in addition to JWTs.
- **`api_key`:** Standalone authentication using pre-shared API keys. Requires no external identity provider.
- **`none`:** Insecure mode for local development and Docker testing. Authentication is completely disabled.
# Insecure mode (`AUTH_MODE=none`)

When `AUTH_MODE=none`:

- `OAUTH_ISSUER` is not required; all `OAUTH_*` environment variables are ignored (scope names still use defaults or configured values).
- ok-fine refuses to start unless `HOST` is a loopback address (`127.0.0.0/8`, `::1`, `localhost`) or `ALLOW_UNAUTHENTICATED_NETWORK=true` (default `false`; intended only for a container running behind a `127.0.0.1`-only port mapping, e.g. `docker run -p 127.0.0.1:8080:8080 -e ALLOW_UNAUTHENTICATED_NETWORK=true`).
- Requests are protected against DNS rebinding: requests whose `Host` header is not `localhost`, `127.0.0.1`, `[::1]`, or the host from `PUBLIC_BASE_URL`, or whose `Origin` header is foreign, receive `403 Forbidden`.
- No authorization-server discovery is performed at startup.
- Discovery endpoints (`/.well-known/oauth-protected-resource`, `/.well-known/oauth-protected-resource/mcp`, and `/.well-known/oauth-authorization-server`) are **not registered** (return 404).
- Every request to `/mcp` and `/api/v1/*` is accepted without an `Authorization` header (the header is ignored if present) and is assigned an anonymous principal:
  - Subject: `anonymous`
  - Client ID: `anonymous`
  - Identity: `null`
  - Scopes: read, write, and admin scopes (full admin access: `canRead`, `canWrite`, `canAdmin` all true)
- Because identity is `null`, `human:<id>` actors are rejected with `forbidden_actor`. Use `<producer>/<version>` (e.g. `cli/1.0`, `claude-code/claude-opus-4-5`) or `process:<id>` actors instead.
- A warning is logged at startup. **Never expose `AUTH_MODE=none` beyond localhost.**

# API key authentication

ok-fine supports static pre-shared API keys configured via the `API_KEYS` environment variable.

## Modes

API keys operate in two modes:

- **Standalone (`AUTH_MODE=api_key`):** Authentication relies solely on configured API keys. `API_KEYS` is required (at least one key must be defined). All `OAUTH_*` environment variables are ignored (no `OAUTH_ISSUER` required), loopback `HOST` is not required, and OAuth discovery endpoints (`/.well-known/oauth-protected-resource`, `/.well-known/oauth-protected-resource/mcp`, and `/.well-known/oauth-authorization-server`) are not registered.
- **Additive in OIDC (`AUTH_MODE=oidc`):** When `API_KEYS` is set in `oidc` mode, API keys are accepted **in addition** to JWT access tokens. If `API_KEYS` is unset or empty, only OIDC tokens are accepted.
- **Disabled in insecure mode (`AUTH_MODE=none`):** Setting `API_KEYS` when `AUTH_MODE=none` is a configuration error and prevents server startup (`API_KEYS has no effect when AUTH_MODE=none`).

## Entry format

API keys are configured as a comma-separated list of entries in `API_KEYS`:

```
API_KEYS="<name>:<permission>:<secret>,<name2>:<permission2>:<secret2>"
```

- Entries are separated by commas. Surrounding whitespace around each entry is trimmed; empty entries are ignored.
- Each entry is split on the **first two colons only** (`<name>:<permission>:<secret>`). The secret itself may contain colons.
- **`name`:** Identifier matching `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`. Each key name must be unique.
- **`permission`:** One of `read`, `write`, or `admin`.
- **`secret`:** At least 32 characters, containing no whitespace and no commas (`,`). Must be unique across entries. Generate cryptographically secure keys with:
  ```sh
  openssl rand -hex 32
  ```
- **Safe diagnostics:** Validation error messages never contain secret values; they identify entries by name or 1-based index only.

## Presenting keys: header vs. Bearer

Clients can present an API key in either of two ways:

1. **Configured header:** Sent via the request header defined by `API_KEY_HEADER` (default: `x-api-key`, lowercased, matching `^[A-Za-z0-9-]+$`, cannot be `authorization`). The header carries the raw secret value.
2. **Authorization header:** Sent as `Authorization: Bearer <secret>`.

### Request verification

- Key comparison is constant-time across all configured keys: secrets are compared using SHA-256 digests and `crypto.timingSafeEqual`, scanning all keys without early exit.
- **In `api_key` mode:** A missing or invalid key returns HTTP 401 Unauthorized (`{"error": {"code": "unauthorized", "message": "missing or invalid API key"}}`). A request lacking the required scope returns HTTP 403 Forbidden (`{"error": {"code": "forbidden", "message": "requires <scope name>"}}`).
- **In `oidc` mode with keys:** If the configured API key header (`x-api-key`) is present but does not match any key, the request returns HTTP 401. If `Authorization: Bearer <value>` matches an API key secret, it is authenticated as that key's principal; otherwise, it falls through to standard OIDC JWT validation.
- Configured API key headers are redacted from Fastify access logs alongside `authorization`. Server startup logs only key names and permissions, never secrets.
- `/healthz` remains unauthenticated.

## Permissions and scopes

Each API key permission grants specific scopes (using the configured scope names, default `okf:read`, `okf:write`, `okf:admin`):

| Permission | Granted scopes | Capabilities |
|---|---|---|
| `read` | `[okf:read]` | Read tools and endpoints (`get_index`, `read_concept`, `search_concepts`, `orient`, etc.) |
| `write` | `[okf:read, okf:write]` | Read + write tools and endpoints (`write_concept`, `verify_concept`, `write_file`, etc.) |
| `admin` | `[okf:read, okf:write, okf:admin]` | Full access, including project deletion, archive import, and git sync |

## Identity and access control

When authenticated via an API key, the request principal is assigned:
- **Client ID:** `api-key:<name>`
- **Subject (`sub`):** `api-key:<name>`
- **Identity:** `null`
- **Groups:** `[]` (empty list)

Because identity is `null`, **`human:<id>` actors are rejected with `forbidden_actor`**. Mutating operations must use tool/agent actors (such as `<producer>/<version>`, e.g. `cli/1.0`, `claude-code/claude-opus-4-5`) or `process:<id>`.

Because groups are empty (`groups: []`), API keys with `read` or `write` permissions cannot access projects with [per-project access control](#project-access-control) (`readGroups` / `writeGroups`). Only `admin` API keys bypass group restrictions via admin bypass.

## Key rotation

To rotate an API key without downtime:

1. Generate a new secret: `openssl rand -hex 32`.
2. Add the new key to `API_KEYS` under a new name (e.g. `ci-v2:write:<new-secret>`) alongside the existing key.
3. Redeploy or restart ok-fine. Both keys are now valid.
4. Update clients to use the new key.
5. Remove the old key entry from `API_KEYS` and redeploy ok-fine.

## Production security

Always serve ok-fine over **HTTPS** in production so API keys are encrypted in transit and never leaked on the network.

# OIDC mode (`AUTH_MODE=oidc`)

In `oidc` mode:

1. At startup it discovers the provider metadata from `OAUTH_ISSUER` and fetches its JWKS. `OAUTH_JWKS_URI` (and any discovered `jwks_uri`) must use `https://` unless `OAUTH_ALLOW_INSECURE_ISSUER=true`.
2. Each request's token is checked for signature, `iss` (exact match with `OAUTH_ISSUER`), `aud` (one of
   `OAUTH_AUDIENCE`), and `exp`.
3. Permissions come from scopes alone, read from the `scope`, `scp`, or `permissions` claims:

| Scope (default) | Grants |
|---|---|
| `okf:read` | read tools and routes |
| `okf:write` | read + write |
| `okf:admin` | everything, including project deletion, archive import, and sync |

By default, every authorized caller can see every project. Access can be restricted per project with `readGroups` and `writeGroups` (see [Project access control](#project-access-control)).

To configure your provider:

- Create an API or resource with audience `<PUBLIC_BASE_URL>/mcp` (or set `OAUTH_AUDIENCE`). `OAUTH_AUDIENCE` must be an API/resource identifier, never an OIDC `client_id` (otherwise ID tokens would pass).
- Define the scopes above as non-default scopes granted only via explicit role or group mappings to authorized clients or users.
- Make sure access tokens are JWTs.
- Set `OAUTH_ISSUER` to the exact `iss` value in the tokens. Auth0 issuers end with `/`.
- `human:<id>` actors are accepted only when `<id>` equals the resolved token identity, determined by trying claims from `OAUTH_IDENTITY_CLAIMS` in order (default `email`, then `preferred_username`, then `sub`):
  - `email` counts only when `email_verified=true`.
  - Any other claim except `sub` whose value contains `@` is skipped (so a user-chosen `preferred_username` like `owner@example.com` can never bind `human:owner@example.com`). Non-email-shaped usernames and `sub` (even if containing `@`) still bind.
  - Email identities compare case-insensitively.
  - Agents derive `<id>` from the developer's `git config user.email`, so the token's `email` claim must carry that address and be verified.

## Access policy

In addition to scope verification, access can be restricted by configuring an access policy using comma-separated lists:

- `OAUTH_ALLOWED_SUBJECTS`: allowed JWT `sub` values (`oidc` mode only).
- `OAUTH_ALLOWED_EMAILS`: allowed user email addresses (compared case-insensitively; requires `email_verified=true`; `oidc` mode only).
- `OAUTH_REQUIRED_GROUPS`: required user groups (`oidc` mode only).
- `OAUTH_GROUPS_CLAIM`: the claim containing user groups (default: `groups`; supports a string or an array of strings; `oidc` mode only). The groups it holds are carried on every request's principal, whether or not `OAUTH_REQUIRED_GROUPS` is set; `AUTH_MODE=none` and stdio sessions have no groups.
- `OAUTH_ALLOWED_CLIENT_IDS`: allowed client IDs matched against `azp`, `client_id`, or `cid` (`oidc` mode only).

A token passes the access policy when:
1. If `OAUTH_ALLOWED_SUBJECTS` or `OAUTH_ALLOWED_EMAILS` is set: `sub` is in the allowed subjects list, OR `email` is in the allowed emails list (case-insensitive) AND `email_verified=true`.
2. If `OAUTH_REQUIRED_GROUPS` is set: the groups claim intersects the required groups list.
3. If `OAUTH_ALLOWED_CLIENT_IDS` is set: the caller's client ID (`azp`, `client_id`, or `cid`) is in the allowed client IDs list.

If any configured policy check fails, the request is rejected with HTTP 403 (`insufficient_scope`). A warning is logged at startup if no access policy variables are set.

In Helm, these correspond to `oauth.allowedSubjects`, `oauth.allowedEmails`, `oauth.requiredGroups`, `oauth.groupsClaim`, and `oauth.allowedClientIds` (as lists).

## Project access control

Access can be restricted per project based on IdP groups carried on the request principal (read from `OAUTH_GROUPS_CLAIM`, default `groups`). Project access rules are configured centrally via the `PROJECT_ACCESS` environment variable (or `PROJECT_ACCESS_FILE`, Helm `access.projects`), never in concept frontmatter where callers with write permissions could alter them:

```json
{
  "hr": {
    "readGroups": ["hr"],
    "writeGroups": ["hr-admins"]
  },
  "finance": {
    "readGroups": ["finance-readers", "finance-team"],
    "writeGroups": ["finance-team"]
  }
}
```

- **Open by default:** Projects without configured rules (or with empty group lists) are accessible to all authenticated callers with appropriate scopes (`okf:read` / `okf:write`).
- **Read access:** Allowed if a project has no `readGroups`, or if the caller's groups intersect `readGroups` (exact case-sensitive match).
- **Write access:** Allowed if read access is allowed AND (project has no `writeGroups` or caller's groups intersect `writeGroups`) AND caller possesses write scope.
- **Admin bypass:** Callers with the admin scope (`okf:admin`, `canAdmin=true`) bypass all project-level group restrictions.
- **Existence hiding (404):** Unreadable projects return `project_not_found` (HTTP 404) on all read and write paths—the identical code and message returned when a project does not exist—so the existence of restricted projects is never leaked. `list_projects` automatically omits unreadable projects, `search_concepts` filters out concepts from unreadable projects before ranking and before applying `limit`, `orient` never returns unreadable projects or their concepts (and returns `project_not_found` when targeted at an unreadable project), and cross-project links into unreadable projects appear as if the target does not exist (`exists: false`), with inbound links from unreadable projects omitted.
- **Forbidden writes (403):** Callers who can read a project but lack write group membership are rejected with `forbidden` (HTTP 403) when attempting mutations.
- **Git remote access:** The single-repository git remote stores all project bundles together. Therefore, direct read access to the git remote provides full read access to every project. Restrict remote repository access accordingly.
- **Interim sensitivity isolation:** For organizations requiring hard isolation for highly sensitive departments (such as HR or executive compensation), deploy a dedicated ok-fine instance backed by its own separate git repository and distinct MCP connector.

# Web UI

ok-fine serves a read-only web UI at `<PUBLIC_BASE_URL>/ui/` (`/` redirects there). It reads only through the
[REST API](https://github.com/ferrule-io/ok-fine/wiki/REST-API) and signs in the same way MCP clients do: it reads
`/.well-known/oauth-protected-resource/mcp`, then the authorization-server metadata, then runs authorization code +
PKCE with `resource=<PUBLIC_BASE_URL>/mcp` and requests the read scope. The access token lives in the tab's session
storage; there are no refresh tokens, and signing out is local only.

The UI needs a public client at your provider:

- Set `OAUTH_UI_CLIENT_ID` (Helm `oauth.uiClientId`) to a public client (no secret) that allows the authorization
  code grant with PKCE, redirect URI `<PUBLIC_BASE_URL>/ui/callback`, and web origin `<PUBLIC_BASE_URL>` (CORS on the
  token endpoint). Its access tokens must carry the audience and scopes above. Providers that need a non-standard
  `audience` parameter must enable RFC 8707 `resource` support.
- Or leave it unset: the UI then registers itself through dynamic client registration when the provider advertises
  `registration_endpoint`. With neither, the UI shows a "Sign-in isn't configured" page listing these values.

In `AUTH_MODE=api_key`, the web UI prompts the user to enter their API key, stores it in `sessionStorage`, and sends it as `Authorization: Bearer <key>` on all REST API requests. If a request returns HTTP 401, the stored key is cleared and the prompt re-appears. Signing out clears the stored key.

In `AUTH_MODE=none` the UI opens without signing in.

For exercising OIDC locally or running tests without an external provider, `src/dev/issuer.ts` (`node dist/dev/issuer-cli.js`) provides an unauthenticated token minter. Its `/authorize` endpoint auto-approves browser sign-ins (`login_hint` sets the username) and `/register` accepts any client, so the web UI works against it with or without `OAUTH_UI_CLIENT_ID`. **Never expose it in production.**

## Web UI security headers

Web UI routes (`/ui/`, `/`, `/ui/config.json`, assets, and error responses) send fixed, non-configurable security headers:

- **CSP:** App shell uses `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' <IdP origins>; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'` ('unsafe-inline' styles are for Shiki highlighting, `img-src` excludes remote images so they can't leak reader IPs, and `upgrade-insecure-requests` is added only when `PUBLIC_BASE_URL` is https).
- **SVG responses:** Sandboxed CSP `default-src 'none'; style-src 'unsafe-inline'; sandbox`.
- **Framing:** `frame-ancestors 'none'` and `X-Frame-Options: DENY`.
- **MIME:** `X-Content-Type-Options: nosniff`.
- **Referrer:** `Referrer-Policy: no-referrer`.
- **COOP:** `Cross-Origin-Opener-Policy: same-origin`.
- **Permissions-Policy:** `camera=(), display-capture=(), geolocation=(), microphone=()`.
- **Caching:** `index.html` is `no-cache`, `config.json` is `no-store`, and `assets/*` are immutable (`public, max-age=31536000, immutable`).

In `AUTH_MODE=none` the Host/Origin check also covers `/ui` (foreign Host gets 403). Rendered Markdown blocks remote images (shown as a link instead) and only allows http(s)/mailto/tel external links.

# Public deployment checklist

Before exposing ok-fine on a network or the internet, verify the following:

1. **Always serve over TLS:** Run behind an HTTPS reverse proxy or ingress with a valid TLS certificate.
2. **Disable IdP self-signup:** Turn off self-registration and open social login on your identity provider, or require administrator approval before new accounts can authenticate.
3. **Explicit scope assignment:** Make `okf:*` scopes non-default in your IdP. Grant them only through explicit role or group mappings to authorized users and clients.
4. **Restrict dynamic client registration:** Either disable dynamic client registration and use one pre-registered public client (with loopback redirect URIs), or restrict registration with initial access tokens and trusted host domain allowlists.
5. **Enforce an access policy:** Set `OAUTH_ALLOWED_SUBJECTS`, `OAUTH_ALLOWED_EMAILS`, and/or `OAUTH_REQUIRED_GROUPS` (and optionally `OAUTH_ALLOWED_CLIENT_IDS`) on ok-fine so that arbitrary valid tokens from your IdP are not accepted.
6. **API identifier audience:** Ensure `OAUTH_AUDIENCE` is configured to an API or resource identifier (such as `https://okf.example.com/mcp`), never an OIDC `client_id` (which would allow ID tokens issued for the client to be accepted as access tokens).
7. **Verify negative access:** Test with a freshly self-registered or unprivileged user account to confirm that no token with `okf:*` scopes is issued and requests return 403 Forbidden.

# Local stdio

The npm CLI's stdio mode (`npx -y @ferrule-io/ok-fine`, see
[Running locally](https://github.com/ferrule-io/ok-fine/wiki/Running-Locally)) has no authentication: the trust
boundary is the local user account, and the client gets read, write, and admin permissions. Its identity is
`git config user.email` in the directory the client launches ok-fine from, so `human:<that email>` actors are
accepted (case-insensitively); without a configured email, `human:` actors are rejected. Commits carry
`Okf-Principal: sub=local client=stdio`. `ok-fine serve --no-auth` is the same as `AUTH_MODE=none`.
