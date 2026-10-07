// Builds the Claude Code plugin root from the shared agent package.
//
// agents/hooks/hooks.json is shared by Claude Code, Codex, and Gemini CLI, so it carries Gemini-only events
// (BeforeAgent) and variables (${extensionPath}). Claude Code always loads hooks/hooks.json from a plugin root, and
// Claude Desktop's marketplace sync rejects hook content it does not recognise, so the Claude marketplace entry points
// at a separate root holding the Claude manifest, the skills, the hook script, and a Claude-only hooks.json.
//
// Usage: node scripts/build-claude-plugin.ts <agents-dir> [<out-dir>]   (out-dir defaults to <agents-dir>/claude-code)

import fs from "node:fs/promises";
import path from "node:path";

// Which harness owns each hook event in the shared hooks.json: Claude Code events are kept, other harnesses' events
// (Gemini CLI) are dropped, and an event missing here fails the build so it gets classified.
const EVENT_OWNER: Record<string, "claude" | "other"> = {
  SessionStart: "claude",
  SessionEnd: "claude",
  UserPromptSubmit: "claude",
  PreToolUse: "claude",
  PostToolUse: "claude",
  PostToolUseFailure: "claude",
  PermissionRequest: "claude",
  Notification: "claude",
  SubagentStart: "claude",
  SubagentStop: "claude",
  Stop: "claude",
  PreCompact: "claude",
  BeforeAgent: "other",
  AfterAgent: "other",
  BeforeModel: "other",
  AfterModel: "other",
  BeforeToolSelection: "other",
  BeforeTool: "other",
  AfterTool: "other",
  PreCompress: "other",
};
// Fields the Desktop marketplace sync accepts on matcher groups and hook entries.
const GROUP_FIELDS: Record<string, true> = { matcher: true, hooks: true };
const HOOK_FIELDS: Record<string, true> = { type: true, command: true, timeout: true };
// Gemini's extension-root variable; Claude resolves the root through ${CLAUDE_PLUGIN_ROOT} alone.
// biome-ignore lint/suspicious/noTemplateCurlyInString: literal hook variable, not a template
const GEMINI_ROOT_VAR = "${extensionPath}";

type HookGroup = { matcher?: string; hooks: Record<string, unknown>[] };
type HooksFile = { hooks: Record<string, HookGroup[]> };

function fail(message: string): never {
  throw new Error(`build-claude-plugin: ${message}`);
}

function assertFields(value: Record<string, unknown>, allowed: Record<string, true>, where: string): void {
  for (const key of Object.keys(value)) {
    if (!Object.hasOwn(allowed, key))
      fail(`${where}: field "${key}" is not accepted by the Claude Desktop marketplace`);
  }
}

function claudeHooks(shared: HooksFile): HooksFile {
  const out: HooksFile = { hooks: {} };
  for (const [event, groups] of Object.entries(shared.hooks)) {
    const owner = Object.hasOwn(EVENT_OWNER, event) ? EVENT_OWNER[event] : undefined;
    if (owner === "other") continue;
    if (owner !== "claude") fail(`hooks.json event "${event}" is unclassified; add it to EVENT_OWNER`);
    out.hooks[event] = groups.map((group, i) => {
      assertFields(group, GROUP_FIELDS, `${event}[${i}]`);
      return {
        ...group,
        hooks: group.hooks.map((hook, j) => {
          assertFields(hook, HOOK_FIELDS, `${event}[${i}].hooks[${j}]`);
          return typeof hook.command === "string"
            ? { ...hook, command: hook.command.replaceAll(GEMINI_ROOT_VAR, "") }
            : hook;
        }),
      };
    });
  }
  return out;
}

async function main(argv: string[]): Promise<void> {
  const [agentsArg, outArg] = argv;
  if (!agentsArg) fail("usage: build-claude-plugin.ts <agents-dir> [<out-dir>]");
  const agents = path.resolve(agentsArg);
  const out = path.resolve(outArg ?? path.join(agents, "claude-code"));
  if (agents === out || agents.startsWith(`${out}${path.sep}`)) fail("out-dir must not contain the agents dir");

  // Read everything before touching out-dir so a bad input leaves the previous build intact.
  const shared = JSON.parse(await fs.readFile(path.join(agents, "hooks", "hooks.json"), "utf8")) as HooksFile;
  const hooks = claudeHooks(shared);

  await fs.rm(out, { recursive: true, force: true });
  await fs.mkdir(path.join(out, ".claude-plugin"), { recursive: true });
  await fs.mkdir(path.join(out, "hooks"), { recursive: true });
  await fs.cp(path.join(agents, ".claude-plugin", "plugin.json"), path.join(out, ".claude-plugin", "plugin.json"));
  await fs.cp(path.join(agents, "skills"), path.join(out, "skills"), { recursive: true });
  await fs.cp(path.join(agents, "hooks", "reminder.sh"), path.join(out, "hooks", "reminder.sh"));
  await fs.writeFile(path.join(out, "hooks", "hooks.json"), `${JSON.stringify(hooks, null, 2)}\n`);
  process.stderr.write(`build-claude-plugin: wrote ${out}\n`);
}

await main(process.argv.slice(2));
