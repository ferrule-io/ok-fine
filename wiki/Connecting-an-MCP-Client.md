Locally, clients can start ok-fine themselves over stdio, with no server, URL, or authentication (see
[Running locally](https://github.com/ferrule-io/ok-fine/wiki/Running-Locally)). Any number of concurrent sessions can share the same data directory with no extra configuration:

```json
{
  "mcpServers": {
    "ok-fine": {
      "command": "npx",
      "args": ["-y", "@ferrule-io/ok-fine"]
    }
  }
}
```

Over HTTP, the MCP endpoint is `<PUBLIC_BASE_URL>/mcp`. It serves the `2026-07-28` protocol and the legacy `2025-11-25`,
`2025-06-18`, and `2025-03-26` protocols statelessly.

When running with `AUTH_MODE=none`, no `Authorization` header or OAuth configuration is needed; point clients directly at `http://localhost:8080/mcp`:

```json
{
  "mcpServers": {
    "ok-fine": {
      "type": "http",
      "url": "http://localhost:8080/mcp"
    }
  }
}
```

In `AUTH_MODE=oidc`, clients that support MCP authorization discover the identity provider from the 401 challenge
(`WWW-Authenticate: Bearer … resource_metadata="<PUBLIC_BASE_URL>/.well-known/oauth-protected-resource/mcp"`).
Clients that take a static header can pass `Authorization: Bearer <token>` directly:

```json
{
  "mcpServers": {
    "ok-fine": {
      "type": "http",
      "url": "https://okf.example.com/mcp",
      "headers": { "Authorization": "Bearer ${OKF_TOKEN}" }
    }
  }
}
```

The server sends usage instructions to the client on connect (note: claude.ai and Claude Desktop drop `instructions`, so the same routing guidance is included in the `list_projects` and `search_concepts` tool descriptions). In short:
1. If a project is named explicitly by the user or workspace instructions, use it.
2. In a git repository with a remote, resolve with `list_projects` passing `repository` (e.g. from `git remote get-url origin`); if none match, offer onboarding via the ok-fine-onboard skill.
3. Otherwise (no repository, no shell, or no remote), call `list_projects` without arguments and pick by title and description, or search across all projects with `search_concepts` omitting `project`. Never run git commands or offer onboarding on this path.

Discover with `get_index` or `search_concepts`, read with `read_concept`, write with `write_concept` passing `expectedRevision`, and prefer `status: deprecated` over deleting.
