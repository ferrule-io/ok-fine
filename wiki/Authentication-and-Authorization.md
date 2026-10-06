ok-fine supports two authentication modes configured via `AUTH_MODE`:

- **`oidc` (default):** ok-fine acts as an OAuth 2.1 **resource server only**. It issues no tokens; it validates JWT
  access tokens from any OIDC / RFC 8414 provider (Keycloak, Auth0, Okta, Zitadel, …).
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

Every authorized caller can see every project.

To configure your provider:

- Create an API or resource with audience `<PUBLIC_BASE_URL>/mcp` (or set `OAUTH_AUDIENCE`). `OAUTH_AUDIENCE` must be an API/resource identifier, never an OIDC `client_id` (otherwise ID tokens would pass).
- Define the scopes above as non-default scopes granted only via explicit role or group mappings to authorized clients or users.
- Make sure access tokens are JWTs.
- Set `OAUTH_ISSUER` to the exact `iss` value in the tokens. Auth0 issuers end with `/`.
- `human:<id>` actors are accepted only when `<id>` equals the first claim found in `OAUTH_IDENTITY_CLAIMS`
  (default `email`, then `preferred_username`, then `sub`). The `email` identity claim is used for `human:<id>` only when `email_verified=true`; otherwise the next claim is tried. Email identities compare case-insensitively. Agents derive `<id>` from the developer's `git config user.email`, so the token's `email` claim must carry that address and be verified.

## Access policy

In addition to scope verification, access can be restricted by configuring an access policy using comma-separated lists:

- `OAUTH_ALLOWED_SUBJECTS`: allowed JWT `sub` values (`oidc` mode only).
- `OAUTH_ALLOWED_EMAILS`: allowed user email addresses (compared case-insensitively; requires `email_verified=true`; `oidc` mode only).
- `OAUTH_REQUIRED_GROUPS`: required user groups (`oidc` mode only).
- `OAUTH_GROUPS_CLAIM`: the claim containing user groups (default: `groups`; supports a string or an array of strings; `oidc` mode only).
- `OAUTH_ALLOWED_CLIENT_IDS`: allowed client IDs matched against `azp`, `client_id`, or `cid` (`oidc` mode only).

A token passes the access policy when:
1. If `OAUTH_ALLOWED_SUBJECTS` or `OAUTH_ALLOWED_EMAILS` is set: `sub` is in the allowed subjects list, OR `email` is in the allowed emails list (case-insensitive) AND `email_verified=true`.
2. If `OAUTH_REQUIRED_GROUPS` is set: the groups claim intersects the required groups list.
3. If `OAUTH_ALLOWED_CLIENT_IDS` is set: the caller's client ID (`azp`, `client_id`, or `cid`) is in the allowed client IDs list.

If any configured policy check fails, the request is rejected with HTTP 403 (`insufficient_scope`). A warning is logged at startup if no access policy variables are set.

In Helm, these correspond to `oauth.allowedSubjects`, `oauth.allowedEmails`, `oauth.requiredGroups`, `oauth.groupsClaim`, and `oauth.allowedClientIds` (as lists).

For exercising OIDC locally or running tests without an external provider, `src/dev/issuer.ts` (`node dist/dev/issuer-cli.js`) provides an unauthenticated token minter. **Never expose it in production.**

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
