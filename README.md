# ok-fine

A knowledge repository for AI agents. ok-fine stores project knowledge as
[Open Knowledge Format (OKF) v0.2](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)
bundles and serves it over **MCP** (Streamable HTTP) and a **REST JSON API**, protected by OAuth 2.1 bearer tokens
from your own identity provider.

- One OKF bundle per project; one markdown concept per file with YAML frontmatter.
- Every change is a git commit, attributed to the writing agent or human, with optional two-way sync to a remote.
- Full-text keyword search (BM25), trust tiers (`unverified` → `machine-confirmed` → `human-reviewed`), staleness,
  link graph, and OKF conformance linting.
- Ships as a container image and a Helm chart.

## Quick start (local)

Requires Docker, plus `curl` for the examples.

> **Warning:** `AUTH_MODE=none` disables authentication completely and gives every caller full admin access. Never expose it beyond localhost.

```sh
docker run --rm -p 127.0.0.1:8080:8080 -e AUTH_MODE=none -e PUBLIC_BASE_URL=http://localhost:8080 -v okf-data:/data ghcr.io/ferrule-io/ok-fine:latest
```

Or, from a checkout, with Docker Compose (pulls the published image, or builds it from source when the pull fails):

```sh
docker compose up -d
```

Create a project, write a concept, and search:

```sh
curl -s -X POST localhost:8080/api/v1/projects \
  -H 'x-okf-actor: cli/1.0' \
  -H 'content-type: application/json' \
  -d '{"project":"demo","title":"Demo"}'

cat > orders.md <<'EOF'
---
type: Reference
title: Orders
description: One row per completed customer order.
tags: [sales]
---

# Orders

Joined with [customers](/tables/customers.md) on `customer_id`.
EOF

curl -s -X PUT localhost:8080/api/v1/projects/demo/concepts/tables/orders \
  -H 'x-okf-actor: cli/1.0' \
  -H 'content-type: text/markdown' --data-binary @orders.md

curl -s "localhost:8080/api/v1/search?q=orders"
```

Next, [connect an MCP client](https://github.com/ferrule-io/ok-fine/wiki/Connecting-an-MCP-Client) to `http://localhost:8080/mcp`.

## Documentation

The [wiki](https://github.com/ferrule-io/ok-fine/wiki) covers everything else:

- [How it works](https://github.com/ferrule-io/ok-fine/wiki/How-It-Works): data layout, concepts, actors, trust tiers
- [Connecting an MCP client](https://github.com/ferrule-io/ok-fine/wiki/Connecting-an-MCP-Client)
- [Using ok-fine from coding agents](https://github.com/ferrule-io/ok-fine/wiki/Coding-Agents): agent package, lifecycle, per-harness setup
- [MCP tools](https://github.com/ferrule-io/ok-fine/wiki/MCP-Tools)
- [REST API](https://github.com/ferrule-io/ok-fine/wiki/REST-API)
- [Authentication and authorization](https://github.com/ferrule-io/ok-fine/wiki/Authentication-and-Authorization)
- [Git storage and remote sync](https://github.com/ferrule-io/ok-fine/wiki/Git-Storage-and-Remote-Sync)
- [Configuration](https://github.com/ferrule-io/ok-fine/wiki/Configuration): environment variables
- [Deploying with Helm](https://github.com/ferrule-io/ok-fine/wiki/Deploying-with-Helm)
- [Development](https://github.com/ferrule-io/ok-fine/wiki/Development): build, test, layout, CI and releases

## License

[Apache License 2.0](LICENSE).
