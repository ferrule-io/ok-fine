All routes are under `/api/v1` and require `Authorization: Bearer <token>` in `oidc` mode (in `none` mode, no token is required). Write and admin routes require an
`X-OKF-Actor` header. Responses carrying a revision set `ETag`; send `If-Match: "<revision>"` for conditional
updates or `If-None-Match: *` for create-only PUTs of concepts and files (other routes reject it with 400).

| Method | Path | Scope | Notes |
|---|---|---|---|
| GET | `/projects` | read | `?repository=<git remote URL>` |
| POST | `/projects` | write | `{ project, title, description? }` → 201 |
| GET | `/projects/:project` | read | summary with type and trust tier counts |
| DELETE | `/projects/:project` | admin | |
| GET | `/projects/:project/index` | read | `?path=<dir>` |
| GET | `/projects/:project/concepts/<id>` | read | JSON; `Accept: text/markdown` returns the raw file |
| PUT | `/projects/:project/concepts/<id>` | write | JSON `{ frontmatter, body, message? }` or a raw `text/markdown` file; 201 when created |
| DELETE | `/projects/:project/concepts/<id>` | write | |
| POST | `/projects/:project/verifications` | write | `{ id }` → 201 |
| GET | `/projects/:project/files/<path>` | read | raw content |
| PUT | `/projects/:project/files/<path>` | write | `text/*` or `application/octet-stream` (UTF-8, no NUL) |
| DELETE | `/projects/:project/files/<path>` | write | |
| GET | `/projects/:project/history` | read | `?id=&limit=` |
| GET | `/projects/:project/lint` | read | |
| GET | `/projects/:project/archive` | read | `.tar.gz` export of the committed bundle |
| PUT | `/projects/:project/archive` | admin | import a `.tar.gz` (single top-level directory); replaces the project |
| GET | `/search` | read | `q` (max 512 chars), `project`, `type`, `tag` (repeatable), `status`, `trustTier`, `stale`, `limit` |
| GET | `/sync` | read | remote sync status |
| POST | `/sync` | admin | sync now |

Errors use one shape: `{ "error": { "code", "message", "details"? } }`. Codes include `invalid_id`,
`invalid_actor`, `forbidden_actor`, `project_not_found`, `not_found`, `already_exists`, `revision_conflict`,
`upstream_conflict`, `payload_too_large`, `unsupported_media`, and `bundle_not_conformant`.

Unauthenticated endpoints: `GET /healthz` (always unauthenticated). In `oidc` mode, the OAuth discovery routes
`GET /.well-known/oauth-protected-resource[/mcp]` and `GET /.well-known/oauth-authorization-server` are also
unauthenticated. In `none` mode, all MCP and API endpoints accept unauthenticated requests, and OAuth discovery
routes are not registered (return 404).
