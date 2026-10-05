// pi / oh-my-pi extension: tells the agent which git repository the session is in, once per session, so it can
// resolve the repository's ok-fine project. Mirrors hooks/session-start.sh (Claude Code, Codex, Gemini CLI).
// No imports: pi and omp load this file directly and share the structural API declared below.

interface ExecResult {
  stdout: string;
  code: number;
}

interface SessionEntry {
  type: string;
  customType?: string;
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
const injected = new WeakSet<object>();

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
      const session = ctx.sessionManager;
      if (injected.has(session)) return undefined;
      if (session.getBranch().some((e) => e.type === "custom_message" && e.customType === CUSTOM_TYPE)) {
        return undefined;
      }
      const url = await remoteUrl(pi, ctx.cwd);
      if (url === null) return undefined;
      injected.add(session);
      return {
        message: {
          customType: CUSTOM_TYPE,
          content: `ok-fine: this workspace is the git repository ${url}. Its shared project knowledge is kept in the ok-fine MCP server, not in this codebase. Before non-trivial work, call the ok-fine list_projects tool with repository set to ${url}, then follow the ok-fine skill. If no project matches, say so once and offer the ok-fine-onboard skill. If the ok-fine tools are unavailable, mention it once and continue.`,
          display: false,
        },
      };
    } catch {
      return undefined;
    }
  });
}
