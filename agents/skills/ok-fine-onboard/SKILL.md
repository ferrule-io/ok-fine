---
name: ok-fine-onboard
description: "Onboard the current git repository to ok-fine: create or choose its ok-fine project, bind the repository's git remote to it, and bootstrap initial knowledge from the codebase. Use when the user asks to onboard, connect, bind, or set up this repository with ok-fine, or agrees to onboard after ok-fine reports the repository is not onboarded. Never modifies files in the repository."
---

# ok-fine-onboard

## 1. Preconditions
1. Verify the current working directory is inside a git working tree with a configured remote:
   - Run `git remote get-url origin`.
   - If that fails, get the first remote name from `git remote` and run `git remote get-url <name>`.
   - If no remote exists, stop and inform the user that a git remote URL is required to onboard to ok-fine.
2. Verify connectivity to ok-fine:
   - Call `list_projects`.
   - If the tool is missing or returns an error, stop and report that the `ok-fine` MCP server is not connected.

## 2. Already bound
1. Call `list_projects` with `repository` set to the remote URL.
2. If the returned `projects` array is non-empty:
   - Report the matching project(s) to the user.
   - Suggest running the `ok-fine-review` skill to audit or refresh knowledge.
   - Stop; do not re-onboard.

## 3. Choose the project
1. Derive the proposed project name:
   - Extract the last path segment of the normalized repository (the `repositories` value `list_projects` reports, e.g. `shop` from `github.com/acme/shop`).
   - Convert to lowercase, replace any sequence of characters outside `[a-z0-9-]` with `-`, trim leading and trailing `-`, and truncate to 63 characters.
   - Verify the name matches `^[a-z0-9][a-z0-9-]{0,62}$`.
2. Call `list_projects` without parameters to inspect existing project titles.
3. If the user's prompt specified the project name or specified whether to create a new project or bind to an existing one, proceed directly.
4. Otherwise, present the existing project titles and ask the user whether to create a new project `<name>` or bind this repository to an existing project (e.g. for monorepos or multi-repo products).

## 4. Create
1. If creating a new project:
   - Call `create_project` with:
     - `project`: `<name>`
     - `title`: repository name
     - `description`: first sentence of the repository README (omit if unavailable)
     - `actor`: `<harness>/<model>`
2. Error handling:
   - On `already_exists`, inform the user and ask whether to bind to that existing project.
   - On `forbidden` or insufficient scope error, stop and inform the user that the token requires the `okf:write` scope.

## 5. Bind
1. Read the project overview:
   - Call `read_concept` with `project: <project>` and `id: "overview"`.
   - Capture the current `frontmatter` and `revision`.
2. Update the overview to bind the remote URL:
   - Prepare `repositories` from the existing frontmatter value: a string becomes a one-element list, a list keeps its string items, and an absent value becomes an empty list. Append the remote URL exactly as output by git, removing any `user:password@` credentials, unless the list already contains it.
   - Call `write_concept` with:
     - `project`: `<project>`
     - `id`: `"overview"`
     - `frontmatter`: retain all existing frontmatter keys, updating `repositories`.
     - `body`: retain the existing body.
     - `actor`: `<harness>/<model>`
     - `expectedRevision`: the revision from `read_concept`.
     - `message`: `"Bind repository <remote-url>"`
3. Verify the binding:
   - Call `list_projects` with `repository` set to the remote URL.
   - Confirm the project appears in the returned list.

## 6. Bootstrap
Read repository files to extract project context. Never create or edit files in the repository.

1. Inspect relevant repository sources:
   - `README` / `README.md`
   - Documentation in `docs/`
   - Architecture Decision Records (e.g. `docs/adr/`, `adr/`)
   - Guidelines: `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `CONTRIBUTING.md`
   - Package manifests: `package.json`, `Cargo.toml`, `go.mod`, `pom.xml`, etc.
   - CI workflows: `.github/workflows/`, `.gitlab-ci.yml`, etc.
   - Deploy configs: `Dockerfile`, `docker-compose.yml`, Helm charts, Kubernetes manifests, Terraform, etc.
   - Top-level directories, entry points, test suites
   - Recent commit log: `git log --oneline -200`
2. Write initial concepts in the following order:
   - Pass `expectedRevision: null` (except for `overview`, where `expectedRevision` is passed).
   - Pass `actor: <harness>/<model>`.
   - Include `sources` with `id`, `resource` (`<normalized repository>/<path>`), and `commit` (`git rev-parse HEAD`).
   - Use `status: draft` unless a source explicitly confirms the fact.
   - Never record secrets, tokens, credentials, or personal data.
   - Ordered sequence:
     1. `overview`: rewrite body with purpose, users, stack, layout, and how to build/test/run with links to runbooks.
     2. `architecture/system`: system architecture and overall flow.
     3. `architecture/<component>`: key components (maximum 8).
     4. `conventions/<slug>`: conventions evidenced by configs or guides (maximum 6).
     5. `runbooks/build-and-test`, `runbooks/run-locally`, and `runbooks/release` (release only if evidenced).
     6. `interfaces/<slug>`: external APIs, contracts, or schemas (maximum 6).
     7. `decisions/<slug>`: decisions backed by explicit evidence (ADRs, design docs, commit logs; set `status: stable` if sourced from an ADR).
     8. `glossary/<term>`: domain terminology (maximum 10).
3. Enforce the hard cap: maximum 30 concepts total. Prefer fewer, high-value concepts.

## 7. Lint
1. Call `lint_project` with `project: <project>`.
2. Fix all reported errors and warnings in the concepts created during bootstrapping by updating them with `write_concept` and their latest `expectedRevision`.

## 8. Report
1. Present a summary of created concepts grouped by type.
2. Note any skipped topics or components and the reasons.
3. Highlight key concepts recommended for human review (suggest running `ok-fine-review`).
4. Confirm explicitly that no files in the codebase were created or modified.
