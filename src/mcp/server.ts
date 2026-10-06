import { type CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Logger } from "../config.js";
import { OkfError } from "../errors.js";
import type { KnowledgeService } from "../service/knowledge-service.js";
import type { Principal } from "../service/principal.js";
import { VERSION } from "../version.js";

export const INSTRUCTIONS = `ok-fine holds shared project knowledge outside the codebase, as OKF v0.2 markdown concepts grouped into projects. In a git repository, first run \`git remote get-url origin\` and call list_projects with that URL as \`repository\`; use the returned project(s) for every read and write. If none match, say the repository is not onboarded and offer to onboard it (ok-fine-onboard skill). Search before non-trivial work; record durable decisions, conventions, and runbooks afterwards.
1. Discover: get_index (progressive disclosure) or search_concepts with \`project\`.
2. Read: read_concept returns frontmatter, body, trust tier (unverified | machine-confirmed | human-reviewed), staleness, and links. Prefer human-reviewed, non-stale concepts; deprecated concepts are history; when code contradicts a concept, trust the code and update the concept.
3. Write: write_concept with frontmatter containing \`type\` (e.g. Decision, Convention, Architecture, Component, Playbook, Interface, Reference) plus \`title\`, \`description\`, \`tags\`. Record provenance in \`sources\` (each with \`resource\` and a stable \`id\`) and cite claims with footnotes [^id]. Link concepts with bundle-absolute links such as [orders](/tables/orders.md).
4. Pass \`actor\` as <harness>/<model> (e.g. claude-code/claude-opus-4-5, codex/gpt-5-codex, gemini-cli/gemini-2.5-pro). Use human:<email>, with the email from \`git config user.email\`, only when the user personally reviewed the concept; on forbidden_actor, report both identities instead of retrying as another. The server stamps \`generated\`; \`verified\` changes only through verify_concept.
5. When updating, pass expectedRevision from read_concept (null to create only).
6. Prefer \`status: deprecated\` over delete_concept. index.md and log.md are maintained by the server; do not write them. A project is bound to repositories through the \`repositories\` list in its overview frontmatter.`;

const project = z.string().describe("Project (bundle) name, e.g. payments-api");
const id = z.string().describe("Concept ID = bundle-relative path without .md, e.g. tables/orders");
const actor = z
  .string()
  .describe(
    "Who is writing, per the OKF actor convention: <producer>/<version> for agents (e.g. claude-code/claude-opus-4-5), human:<email> (the user's `git config user.email`, matching their token identity) only for personal review, or process:<id>",
  );
const expectedRevision = z
  .string()
  .nullable()
  .optional()
  .describe("Revision from read_concept; null = must not exist yet; omit to overwrite unconditionally");
const expectedExisting = z.string().optional().describe("Revision from read_concept; omit to act unconditionally");
const limit = z.number().int().min(1).max(100).optional();

type Permission = "read" | "write" | "admin";

function fail(code: string, message: string, details?: unknown): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: `${code}: ${message}` }],
    structuredContent: { error: { code, message, details } },
  };
}

export function createMcpServer(service: KnowledgeService, principal: Principal, log: Logger): McpServer {
  const server = new McpServer({ name: "ok-fine", version: VERSION }, { instructions: INSTRUCTIONS });

  const run = async (name: string, fn: () => unknown): Promise<CallToolResult> => {
    try {
      const result = await fn();
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result as Record<string, unknown>,
      };
    } catch (err) {
      if (err instanceof OkfError) return fail(err.code, err.message, err.details);
      log.error({ err, tool: name }, "tool failed");
      return fail("internal", "internal error");
    }
  };

  const tool = <S extends z.ZodObject>(
    name: string,
    need: Permission,
    config: { title: string; description: string; inputSchema: S; annotations?: Record<string, boolean> },
    fn: (args: z.infer<S>) => unknown,
  ): void => {
    const permitted = need === "admin" ? principal.canAdmin : need === "write" ? principal.canWrite : principal.canRead;
    if (!permitted) return;
    // Widen to the concrete ZodObject so the SDK's overload resolves; the SDK has already validated `args`
    // against this schema, so the cast only restores the inferred type.
    const inputSchema: z.ZodObject = config.inputSchema;
    server.registerTool(name, { ...config, inputSchema }, async (args: unknown) =>
      run(name, () => fn(args as z.infer<S>)),
    );
  };

  const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

  tool(
    "list_projects",
    "read",
    {
      title: "List projects",
      description:
        "List projects (OKF bundles) with concept and staleness counts and the git repositories bound to each; pass repository to find the projects that hold a codebase's knowledge.",
      inputSchema: z.object({
        repository: z
          .string()
          .optional()
          .describe(
            "Git remote URL of the current repository, e.g. the output of `git remote get-url origin`; returns only the projects bound to it",
          ),
      }),
      annotations: readOnly,
    },
    (a) => service.listProjects({ repository: a.repository }),
  );

  tool(
    "get_index",
    "read",
    {
      title: "Get directory index",
      description:
        "Progressive-disclosure listing of one bundle directory: its concepts grouped by type, files, and subdirectories.",
      inputSchema: z.object({ project, path: z.string().optional().describe("directory, default bundle root") }),
      annotations: readOnly,
    },
    (a) => service.getIndex(a.project, a.path ?? ""),
  );

  tool(
    "read_concept",
    "read",
    {
      title: "Read concept",
      description:
        "Read one concept with frontmatter, body, derived trust/staleness, links, and lint issues; returns `revision` to pass back as expectedRevision when updating.",
      inputSchema: z.object({ project, id }),
      annotations: readOnly,
    },
    (a) => service.readConcept(a.project, a.id),
  );

  tool(
    "search_concepts",
    "read",
    {
      title: "Search concepts",
      description:
        "Keyword full-text search over concepts, optionally filtered by project, type, tags, status, trust tier, and staleness.",
      inputSchema: z.object({
        query: z.string().optional(),
        project: z.string().optional(),
        type: z.string().optional(),
        tags: z.array(z.string()).optional(),
        status: z.enum(["draft", "stable", "deprecated"]).optional().describe("omitted hides deprecated"),
        trustTier: z.enum(["unverified", "machine-confirmed", "human-reviewed"]).optional(),
        stale: z.boolean().optional(),
        limit,
      }),
      annotations: readOnly,
    },
    (a) => service.search(a),
  );

  tool(
    "get_history",
    "read",
    {
      title: "Get history",
      description: "List git commits that changed a concept, or the whole project when id is omitted.",
      inputSchema: z.object({ project, id: id.optional(), limit }),
      annotations: readOnly,
    },
    (a) => service.history(a.project, a.id, a.limit),
  );

  tool(
    "read_file",
    "read",
    {
      title: "Read file",
      description: "Read any text file in a bundle verbatim (including index.md, log.md, and non-markdown assets).",
      inputSchema: z.object({ project, path: z.string().describe("bundle-relative file path") }),
      annotations: readOnly,
    },
    (a) => service.readFile(a.project, a.path),
  );

  tool(
    "lint_project",
    "read",
    {
      title: "Lint project",
      description: "Check a bundle for OKF v0.2 conformance and return errors, warnings, and info issues.",
      inputSchema: z.object({ project }),
      annotations: readOnly,
    },
    (a) => service.lint(a.project),
  );

  tool(
    "create_project",
    "write",
    {
      title: "Create project",
      description: "Create a new project bundle with an overview concept, log.md, and index.md.",
      inputSchema: z.object({ project, title: z.string(), description: z.string().optional(), actor }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    (a) => service.createProject(principal, a),
  );

  tool(
    "write_concept",
    "write",
    {
      title: "Write concept",
      description:
        "Create or replace a concept's whole frontmatter and body; the server stamps `generated` and ignores `verified` (use verify_concept).",
      inputSchema: z.object({
        project,
        id,
        frontmatter: z.record(z.string(), z.unknown()).describe("YAML frontmatter as an object; `type` is required"),
        body: z.string().describe("Markdown body"),
        actor,
        expectedRevision,
        message: z.string().optional().describe("Optional note recorded in log.md and the commit"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    (a) => service.writeConcept(principal, a),
  );

  tool(
    "verify_concept",
    "write",
    {
      title: "Verify concept",
      description: "Append a verification by `actor` to a concept's `verified` list, raising its trust tier.",
      inputSchema: z.object({ project, id, actor, expectedRevision: expectedExisting }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    (a) => service.verifyConcept(principal, a),
  );

  tool(
    "delete_concept",
    "write",
    {
      title: "Delete concept",
      description:
        "Permanently remove a concept; prefer write_concept with `status: deprecated` to keep history visible.",
      inputSchema: z.object({ project, id, actor, expectedRevision: expectedExisting }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    (a) => service.deleteConcept(principal, a),
  );

  tool(
    "write_file",
    "write",
    {
      title: "Write file",
      description: "Create or replace a non-markdown asset file in a bundle (e.g. references/attesters/x.py).",
      inputSchema: z.object({
        project,
        path: z.string().describe("bundle-relative path; must not end with .md"),
        content: z.string(),
        actor,
        expectedRevision,
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    (a) => service.writeFile(principal, a),
  );

  tool(
    "delete_file",
    "write",
    {
      title: "Delete file",
      description: "Remove a non-markdown asset file from a bundle.",
      inputSchema: z.object({ project, path: z.string(), actor, expectedRevision: expectedExisting }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    (a) => service.deleteFile(principal, a),
  );

  tool(
    "delete_project",
    "admin",
    {
      title: "Delete project",
      description: "Delete an entire project bundle; `confirm` must repeat the project name.",
      inputSchema: z.object({ project, actor, confirm: z.string().describe("must equal project") }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    (a) => {
      if (a.confirm !== a.project) throw new OkfError("bad_request", 400, "confirm must equal project");
      return service.deleteProject(principal, { project: a.project, actor: a.actor });
    },
  );

  tool(
    "sync_now",
    "admin",
    {
      title: "Sync now",
      description: "Fetch, rebase onto, and push to the configured git remote immediately and return sync status.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    () => service.syncNow(),
  );

  return server;
}
