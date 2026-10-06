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

The server sends usage instructions to the client on connect. In short: resolve the current repository's project
with `list_projects` and `repository`, discover with `get_index`, read with `read_concept`, write with
`write_concept` passing `expectedRevision`, and prefer `status: deprecated` over deleting.
