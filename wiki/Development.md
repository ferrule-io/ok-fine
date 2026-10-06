```sh
mise install          # Node 24, pnpm 11
pnpm install
pnpm typecheck
pnpm lint             # biome check: lint, formatting, import order; warnings fail
pnpm format           # biome check --write: apply formatting and import order
pnpm test             # unit, service (real git in temp dirs), and end-to-end suites
pnpm build
```

Layout:

| Path | Responsibility |
|---|---|
| `src/okf/` | Pure OKF logic: frontmatter round-trip, semantics, paths, links, index/log rendering, lint |
| `src/store/` | Git, filesystem, catalog + search index, archives, remote sync |
| `src/service/` | `KnowledgeService`: one method per operation, shared by MCP and REST |
| `src/auth/` | OIDC discovery, JWT verification, bearer challenges |
| `src/mcp/`, `src/http/` | MCP tools and REST routes |
| `src/server.ts` | Wiring (used by `main.ts` and the end-to-end test) |
| `src/dev/` | Development token issuer |
| `charts/ok-fine/` | Helm chart |
| `agents/` | Agent package (skills, SessionStart hook, pi/omp extension, harness manifests); mirrored to `ferrule-io/ok-fine-agents` |
| `wiki/` | GitHub wiki source; mirrored to the repository wiki on release |

## CI and releases

- **Push to `development`** and **PRs into `development`/`main`** run `.github/workflows/ci.yml`: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `helm lint --strict`, and (pushes to `development` only) cache-warming Docker builds for `amd64` and `arm64` on native runners. Release skips these builds because it builds the real images itself.
- **Push to `main`** runs `.github/workflows/release.yml`: runs CI, then the `plan` job computes next version (patch+1 over max of `Chart.yaml` version and latest `vX.Y.Z` tag) and creates, without pushing, the commit `chore(release): vX.Y.Z` bumping `charts/ok-fine/Chart.yaml` (version + appVersion), `package.json`, `src/version.ts`, and the agent manifests (`agents/package.json`, `agents/plugin.json`, `agents/gemini-extension.json`, `agents/.claude-plugin/plugin.json`) plus its tag, handed to later jobs as a `git bundle` artifact. The per-arch images build natively from that exact commit and push by digest; only after both succeed does `release-commit` atomically push the commit to `main` with its tag, so a failed image build leaves no tag. Then the images are merged into a multi-arch manifest (tags `X.Y.Z`, `sha-<short>`, and `latest` only when it is the highest release), the chart is pushed to `oci://ghcr.io/ferrule-io/charts`, and the release commit is merged back into `development` (fails rather than force-pushing on conflict). Reruns reuse the existing release commit/tag.
- **Agent package:** the `agents` job replaces the contents of `ferrule-io/ok-fine-agents` with `agents/` plus `LICENSE`, commits, tags `vX.Y.Z`, and pushes (to `main` only when it is the highest release). The mirror is generated output; edit `agents/` here. Reruns skip an existing tag.
- **Wiki:** the `wiki` job replaces the contents of the repository wiki with `wiki/` and commits only when something changed (highest release only). The wiki is generated output; edit `wiki/` here. Prerequisite: save any first page in the wiki UI once so GitHub creates the wiki repository; until then only the `wiki` job fails.
- **One release per run of pushes:** releases are serialized (`concurrency: release`). A push that lands while a release is running supersedes older queued pushes, and a run whose commit is no longer `main`'s head fails with `main moved past <sha>`; the newest push releases everything since the last tag, with a single patch bump.
- **Prerequisites:** if `main`/`development` have branch protection or rulesets, allow GitHub Actions to push to them; make the GHCR `ok-fine` and `charts/ok-fine` packages public after the first release. For the agent package, create the public repository `ferrule-io/ok-fine-agents` with an initial commit on `main`, add a deploy key with write access there, and store its private key as the `AGENTS_DEPLOY_KEY` secret in this repository; until then only the `agents` job fails.
- **Caching:** buildx GHA cache per arch shared by CI and release (`main` reads caches from the default branch `development`), mise toolchain cache, and pnpm store cache keyed on `pnpm-lock.yaml`.
