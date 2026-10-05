# AGENTS.md

Guidance for coding agents working on this repository. User-facing documentation is in [README.md](README.md).

## Commands

```sh
mise install            # Node 24, pnpm 11
pnpm install
pnpm typecheck          # tsc --noEmit over src/, test/, agents/, vitest.config.ts
pnpm test               # vitest: unit, service (real git), end-to-end
pnpm build              # emits dist/
pnpm exec vitest run src/service   # one suite
```

Run `pnpm typecheck && pnpm test` before you finish any change. For chart changes, also run
`helm lint --strict charts/ok-fine --set config.publicBaseUrl=https://okf.example.com --set oauth.issuer=https://idp.example.com`.

## Layout and layering

Dependencies point downward only:

| Layer | Path | Rule |
|---|---|---|
| Format | `src/okf/` | Pure functions, no I/O. All OKF v0.2 rules live here. |
| Storage | `src/store/` | `StorageBackend` contract (`backend.ts`), its git implementation (`git-backend.ts`), bundle model, in-memory catalog/search, archives. |
| Service | `src/service/knowledge-service.ts` | One method per operation. MCP and REST must both call this; never put business logic in transports. Depends only on `StorageBackend`: no repo paths or fs calls except import staging under `DATA_DIR/tmp`. |
| Transport | `src/mcp/`, `src/http/` | Input validation (zod), permission checks, response shaping. |
| Wiring | `src/server.ts` | `startServer(config)`. Shared by `src/main.ts` and `test/e2e.test.ts`; keep all wiring here. |
| Auth | `src/auth/` | JWT resource server. ok-fine never issues tokens. |
| Dev only | `src/dev/` | Unauthenticated token issuer for tests and local runs. Never wire it into the server. |
| Agent package | `agents/` | Skills, SessionStart hook, pi/omp extension, harness manifests. Never imports from `src/`; mirrored to `ferrule-io/ok-fine-agents` on release, so edit here only. |

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
- **Agent-facing text:** tool names and parameters referenced in `agents/` and `INSTRUCTIONS` (`src/mcp/server.ts`)
  must match the registered tools. Agent-facing text must never instruct writing files into a consumer codebase.

## Code conventions

- TypeScript ESM with `NodeNext`: relative imports end in `.js`; use `import type` for type-only imports
  (`verbatimModuleSyntax`).
- Strict mode with `noUncheckedIndexedAccess`. No `any`. Validate external input with zod; keep unchecked casts
  rare and commented.
- Config comes only from `loadConfig(env)`. Don't read `process.env` elsewhere, because tests pass custom env.
- Keep the MCP tool table, REST route table, and environment variable table in README.md in sync with the code.

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
