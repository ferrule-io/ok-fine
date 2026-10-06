# AGENTS.md

Guidance for coding agents working on this repository. User-facing documentation is in [README.md](README.md) (landing page and quick start) and [`wiki/`](wiki/) (everything else, published to the GitHub wiki on release).

## Commands

```sh
mise install            # Node 24, pnpm 11
pnpm install
pnpm typecheck          # tsc --noEmit over src/, test/, agents/, vitest.config.ts
pnpm lint               # biome check (biome.json): lint, formatting, import order; warnings fail too
pnpm format             # biome check --write: apply formatting, import order, and safe lint fixes
pnpm test               # vitest: unit, service (real git), end-to-end
pnpm build              # emits dist/
pnpm exec vitest run src/service   # one suite
```

Run `pnpm format`, then `pnpm typecheck && pnpm lint && pnpm test`, before you finish any change, and before opening
a PR: CI gates PRs on all three. For chart changes, also run
`helm lint --strict charts/ok-fine --set config.publicBaseUrl=https://okf.example.com --set oauth.issuer=https://idp.example.com`.

## Layout and layering

Dependencies point downward only:

| Layer | Path | Rule |
|---|---|---|
| Format | `src/okf/` | Pure functions, no I/O. All OKF v0.2 rules live here. |
| Storage | `src/store/` | `StorageBackend` contract (`backend.ts`), its git implementation (`git-backend.ts`), bundle model, in-memory catalog/search, archives. |
| Service | `src/service/knowledge-service.ts` | One method per operation. MCP and REST must both call this; never put business logic in transports. Depends only on `StorageBackend`: no repo paths or fs calls except import staging under `DATA_DIR/tmp`. |
| Transport | `src/mcp/`, `src/http/` | Input validation (zod), permission checks, response shaping. |
| Wiring | `src/server.ts` | `startServer(config)` (HTTP) and `startStdioServer(config, options)`. Shared by `src/main.ts` (container), `src/cli.ts` (npm bin), and `test/e2e.test.ts`; keep all wiring here. |
| Auth | `src/auth/` | JWT resource server. ok-fine never issues tokens. |
| Dev only | `src/dev/` | Unauthenticated token issuer for tests and local runs. Never wire it into the server. |
| Agent package | `agents/` | Skills, SessionStart hook, pi/omp extension, harness manifests. Never imports from `src/`; mirrored to `ferrule-io/ok-fine-agents` on release, so edit here only. |
| Docs | `wiki/` | GitHub wiki source; the `wiki` job in `release.yml` mirrors it to the repository wiki on release, so edit here only. Page titles come from file names; link between pages with full `https://github.com/ferrule-io/ok-fine/wiki/<Page>` URLs. |

## Invariants

Break any of these and you have a bug.

- **Spec fidelity (OKF v0.2):** unknown frontmatter keys, unknown `type` values, comments, and formatting of
  untouched keys must survive a write (`applyFrontmatter`). Never reject a concept for missing optional fields or
  broken links.
- **Server-managed keys:** `generated` is stamped on every write. `verified` changes only through
  `verify_concept` (`appendVerification`).
- **Generated files:** ok-fine owns every `index.md` (regenerated deterministically after every mutation, import,
  and sync) and the project-root `log.md`. Don't add code paths that let clients write them.
- **Storage state:** all mutations go through `StorageBackend.transaction()` (via its `StorageTx`) or `sync()`;
  in `GitBackend` both hold the single in-process mutex.
  - The resync handler (`setResyncHandler`) runs with the mutex already held and receives its own `StorageTx`;
    it must never call `transaction()` (that deadlocks).
  - Reads never lock. File/dir existence and listings come from the in-memory path index (`PathIndex`), which
    every `StorageTx` write/delete updates and every resync rebuilds; never bypass `StorageTx` to touch the repo.
- **Never lose local commits:** on rebase conflict, `preserveConflict()` keeps them on `ok-fine/conflict-<stamp>`
  (local branch, plus remote when the push succeeds) before resetting.
- **Path safety:**
  - Project names must match `PROJECT_RE` before any path join (`assertProjectExists`).
  - Concept IDs for writes go through `normalizeConceptIdForWrite`, file paths through `normalizeFilePathForWrite`,
    and read paths through `resolveReadPath`.
  - Archive imports reject links, absolute paths, and `..`.
- **Actors:** every write validates `actor` with `checkActor`. `human:<id>` must equal the token identity.
- **Errors:** throw `OkfError(code, status, message, details?)` with the existing codes in `src/errors.ts`.
  Transports map them; don't invent per-transport error shapes.
- **Single replica:** the design assumes one process per data volume (RWO PVC, in-process mutex). Don't add
  horizontal scaling without replacing the locking model.
- **Stdio:** stdout carries only MCP JSON-RPC; the CLI logs to stderr. Never `console.log` in code reachable from
  `startStdioServer`.
- **Local CLI:** `lockDataDir` enforces one process per data dir; host git env (`gitHostEnv`) is CLI-only, so the
  container keeps git isolated under `DATA_DIR/home`.
- **Agent-facing text:** tool names and parameters referenced in `agents/` and `INSTRUCTIONS` (`src/mcp/server.ts`)
  must match the registered tools. Agent-facing text must never instruct writing files into a consumer codebase.

## Code conventions

- TypeScript ESM with `NodeNext`: relative imports end in `.js`; use `import type` for type-only imports
  (`verbatimModuleSyntax`).
- Strict mode with `noUncheckedIndexedAccess`. No `any`. Validate external input with zod; keep unchecked casts
  rare and commented.
- Config comes only from `loadConfig`/`loadStorageConfig(env)`. Don't read `process.env` elsewhere (the entry points
  `src/main.ts` and `src/cli.ts` pass it in), because tests pass custom env.
- Keep the MCP tool table (`wiki/MCP-Tools.md`), REST route table (`wiki/REST-API.md`), and environment variable table (`wiki/Configuration.md`) in sync with the code.

## Tests

- Colocated `src/**/*.test.ts`; end-to-end in `test/e2e.test.ts` (dev issuer + real server + MCP client).
- Anything touching disk uses `fs.mkdtemp(path.join(os.tmpdir(), "okf-"))` and removes it afterwards.
- Service tests use real `git` (bare repos in temp dirs act as remotes); don't mock git.
- Assert exact error codes and observable state (files, commits, catalog), not just that something threw.

## Deployment

- `Dockerfile` builds a slim Node 24 image with `git` and `openssh-client`; it runs as uid 1000 with a read-only
  root filesystem in the chart.
- `charts/ok-fine` deploys a fixed `replicas: 1` with a `Recreate` strategy; the PVC is annotated
  `helm.sh/resource-policy: keep`.
- For Kubernetes testing, use a local cluster (e.g. `minikube -p ok-fine`) and pin `--context`/`--kube-context` on
  every command. Never assume the current context is safe.
- CI/release workflows live in `.github/workflows/` (`ci.yml` reusable via `workflow_call`; `release.yml` on `main`).
- Versions in `charts/ok-fine/Chart.yaml` (version + appVersion), `package.json`, `src/version.ts`, and the agent manifests (`agents/package.json`, `agents/plugin.json`, `agents/gemini-extension.json`, `agents/.claude-plugin/plugin.json`) are bumped by the release workflow — don't hand-edit them.
- Keep the buildx cache scopes (`image-amd64`, `image-arm64`) identical in both workflows.
