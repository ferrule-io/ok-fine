All routes are under `/api/v1` and require `Authorization: Bearer <token>` in `oidc` mode (in `none` mode, no token is required). Write and admin routes require an
`X-OKF-Actor` header. Responses carrying a revision set `ETag`; send `If-Match: "<revision>"` for conditional
updates or `If-None-Match: *` for create-only PUTs of concepts and files (other routes reject it with 400).

| Method | Path | Scope | Notes |
|---|---|---|---|
| GET | `/projects` | read | `?repository=&team=&query=`; returns project summaries with counts, bound repositories, and routing metadata (`teams`, `domains`, `audience`, `keywords`, `owners`) |
| GET | `/orient` | read | `?question=&project=&limit=`; `question` max 512 chars, `limit` max 50; ranks relevant projects and concepts for a question, returns working rules. The hub project (`HUB_PROJECT`) is always listed when it exists, also when `project` narrows the search |
| POST | `/projects` | write | `{ project, title, description? }` → 201 |
| GET | `/projects/:project` | read | summary with type and trust tier counts, routing metadata (`teams`, `domains`, `audience`, `keywords`, `owners`) |
| DELETE | `/projects/:project` | admin | |
| GET | `/projects/:project/index` | read | `?path=<dir>` |
| GET | `/projects/:project/concepts/<id>` | read | JSON (includes `links` with cross-project outbound `{ project, id, exists }` and cross-project inbound `okf://<project>/<id>`); `Accept: text/markdown` returns the raw file |
| PUT | `/projects/:project/concepts/<id>` | write | JSON `{ frontmatter, body, message? }` or a raw `text/markdown` file; 201 when created |
| DELETE | `/projects/:project/concepts/<id>` | write | |
| POST | `/projects/:project/verifications` | write | `{ id }` → 201 |
| GET | `/projects/:project/files/<path>` | read | raw content |
| PUT | `/projects/:project/files/<path>` | write | `text/*` or `application/octet-stream` (UTF-8, no NUL) |
| DELETE | `/projects/:project/files/<path>` | write | |
| GET | `/projects/:project/history` | read | `?id=&limit=` |
| GET | `/projects/:project/lint` | read | includes `unresolved_conflict` warnings |
| GET | `/projects/:project/conflicts` | read | unresolved conflicts of the project |
| GET | `/projects/:project/conflicts/:id/files/<path>` | read | `{ preserved, base, current }` of one conflicting file |
| POST | `/projects/:project/conflicts/:id/resolution` | write | `{ paths, message? }` → 201; `paths` must list every file of the conflict |
| GET | `/projects/:project/archive` | read | `.tar.gz` export of the committed bundle |
| PUT | `/projects/:project/archive` | admin | import a `.tar.gz` (single top-level directory); replaces the project |
| GET | `/search` | read | `q` (max 512 chars), `project`, `type`, `tag` (repeatable), `status`, `trustTier`, `stale`, `limit` |
| GET | `/sync` | read | remote sync status |
| POST | `/sync` | admin | sync now |

Errors use one shape: `{ "error": { "code", "message", "details"? } }`. Codes include `bad_request`, `invalid_id`,
`invalid_actor`, `forbidden_actor`, `project_not_found`, `not_found`, `already_exists`, `revision_conflict`,
`upstream_conflict` (`details.conflicts` names the conflicts that preserved the write), `payload_too_large`,
`unsupported_media`, and `bundle_not_conformant`.

Unauthenticated endpoints: `GET /healthz` (always unauthenticated). In `oidc` mode, the OAuth discovery routes
`GET /.well-known/oauth-protected-resource[/mcp]` and `GET /.well-known/oauth-authorization-server` are also
unauthenticated. In `none` mode, all MCP and API endpoints accept unauthenticated requests, and OAuth discovery
routes are not registered (return 404).

The web UI routes are also unauthenticated (they serve only static assets and public client settings): `GET /`
redirects to `/ui/`, `GET /ui/config.json` returns `{ authMode, oauthClientId, scope, version }`, and `GET /ui/*`
serves the built UI (unknown paths without a file extension return the app shell for client-side routing). They are
absent when the server was built without `dist/ui`. All web UI routes are hardened with strict security headers (see
[Web UI security headers](https://github.com/ferrule-io/ok-fine/wiki/Authentication-and-Authorization#web-ui-security-headers)).
