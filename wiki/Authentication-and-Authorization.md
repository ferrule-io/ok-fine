ok-fine supports two authentication modes configured via `AUTH_MODE`:

- **`oidc` (default):** ok-fine acts as an OAuth 2.1 **resource server only**. It issues no tokens; it validates JWT
  access tokens from any OIDC / RFC 8414 provider (Keycloak, Auth0, Okta, Zitadel, …).
- **`none`:** Insecure mode for local development and Docker testing. Authentication is completely disabled.

# Insecure mode (`AUTH_MODE=none`)

When `AUTH_MODE=none`:

- `OAUTH_ISSUER` is not required; all `OAUTH_*` environment variables are ignored (scope names still use defaults or configured values).
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

1. At startup it discovers the provider metadata from `OAUTH_ISSUER` and fetches its JWKS.
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

- Create an API or resource with audience `<PUBLIC_BASE_URL>/mcp` (or set `OAUTH_AUDIENCE`).
- Define the scopes above and grant them to clients or users.
- Make sure access tokens are JWTs.
- Set `OAUTH_ISSUER` to the exact `iss` value in the tokens. Auth0 issuers end with `/`.
- `human:<id>` actors are accepted only when `<id>` equals the first claim found in `OAUTH_IDENTITY_CLAIMS`
  (default `email`, then `preferred_username`, then `sub`). Email identities compare case-insensitively. Agents
  derive `<id>` from the developer's `git config user.email`, so the token's `email` claim must carry that address.

For exercising OIDC locally or running tests without an external provider, `src/dev/issuer.ts` (`node dist/dev/issuer-cli.js`) provides an unauthenticated token minter. **Never expose it in production.**
