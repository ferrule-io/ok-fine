// pi / oh-my-pi extension: tells the agent which git repository the session is in, per-prompt until an ok-fine
// lookup appears, so it can resolve the repository's ok-fine project. Mirrors hooks/reminder.sh (Claude Code, Codex, Gemini CLI).
// No imports: pi and omp load this file directly and share the structural API declared below.

interface ExecResult {
  stdout: string;
  code: number;
}

interface SessionEntry {
  type: string;
  customType?: string;
  message?: {
    role?: string;
    content?: unknown;
  };
}

interface Ctx {
  cwd: string;
  sessionManager: { getBranch(): SessionEntry[] };
}

interface Api {
  exec(command: string, args: string[], options?: { cwd?: string; timeout?: number }): Promise<ExecResult>;
  on(
    event: "before_agent_start",
    handler: (
      event: unknown,
      ctx: Ctx,
    ) => Promise<{ message: { customType: string; content: string; display: boolean } } | undefined>,
  ): void;
}

const CUSTOM_TYPE = "ok-fine.repository";
const OK_FINE_TOOL_PATTERN =
  /^(?:.*ok[-_]fine.*[_:/.-])?(?:list_projects|search_concepts|read_concept|get_index|orient)$/i;

function fullReminder(url: string): string {
  return `ok-fine: this workspace is the git repository ${url}; its shared project knowledge is kept in the ok-fine MCP server, not in this codebase. Before planning or editing, call the ok-fine list_projects tool with repository set to ${url}, then search_concepts with key terms from the task, and read the relevant concepts with read_concept. Follow the ok-fine skill for drift checks and for recording knowledge afterwards. If no project matches, say so once and offer the ok-fine-onboard skill. If the ok-fine tools are unavailable, mention it once and continue.`;
}

function shortReminder(url: string): string {
  return `ok-fine reminder: before planning or editing, call list_projects with repository set to ${url}, then search_concepts with key terms from this task (skip if the ok-fine tools are unavailable).`;
}

function usedOkFine(entries: SessionEntry[]): boolean {
  for (const entry of entries) {
    if (entry.type !== "message" || entry.message?.role !== "assistant") {
      continue;
    }
    const content = entry.message.content;
    if (!Array.isArray(content)) {
      continue;
    }
    for (const block of content) {
      if (block !== null && typeof block === "object" && "type" in block && block.type === "toolCall") {
        if ("name" in block && typeof block.name === "string" && OK_FINE_TOOL_PATTERN.test(block.name)) {
          return true;
        }
        if ("arguments" in block && block.arguments !== null && typeof block.arguments === "object") {
          // Narrow top-level argument values to strings before testing.
          const args = block.arguments as Record<string, unknown>;
          for (const val of Object.values(args)) {
            if (typeof val === "string" && OK_FINE_TOOL_PATTERN.test(val)) {
              return true;
            }
          }
        }
      }
    }
  }
  return false;
}
async function remoteUrl(pi: Api, cwd: string): Promise<string | null> {
  const git = (args: string[]) => pi.exec("git", ["-C", cwd, ...args], { timeout: 3000 });
  let res = await git(["remote", "get-url", "origin"]);
  if (res.code !== 0) {
    const names = await git(["remote"]);
    const first = names.code === 0 ? names.stdout.trim().split("\n")[0]?.trim() : undefined;
    if (!first) return null;
    res = await git(["remote", "get-url", first]);
    if (res.code !== 0) return null;
  }
  // Drop credentials embedded in URL-form remotes, then refuse anything that needs escaping.
  const url = res.stdout.trim().replace(/^([A-Za-z][A-Za-z0-9+.-]*:\/\/)[^/@]*@/, "$1");
  return /^[A-Za-z0-9@:/._~+%-]+$/.test(url) ? url : null;
}

export default function okFine(pi: Api): void {
  pi.on("before_agent_start", async (_event, ctx) => {
    try {
      const branch = ctx.sessionManager.getBranch();
      if (usedOkFine(branch)) return undefined;

      const url = await remoteUrl(pi, ctx.cwd);
      if (url === null) return undefined;

      const hasPrior = branch.some((e) => e.type === "custom_message" && e.customType === CUSTOM_TYPE);
      const content = hasPrior ? shortReminder(url) : fullReminder(url);

      return {
        message: {
          customType: CUSTOM_TYPE,
          content,
          display: false,
        },
      };
    } catch {
      return undefined;
    }
  });
}
