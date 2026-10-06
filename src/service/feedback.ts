import { OkfError } from "../errors.js";
import { VERSION } from "../version.js";

export const FEEDBACK_REPOSITORY = "https://github.com/ferrule-io/ok-fine";
// github.com answers 500 for logged-out users above ~6900 characters and 414 URI Too Long above ~8200.
export const MAX_FEEDBACK_URL_LENGTH = 6000;
export const FEEDBACK_TYPES = ["bug", "feature", "general"] as const;
export type FeedbackType = (typeof FEEDBACK_TYPES)[number];

export interface FeedbackInput {
  type: FeedbackType;
  title: string;
  body: string;
  tool?: string;
  expected?: string;
  actual?: string;
  reproduction?: string;
}

export interface FeedbackLink {
  url: string;
  title: string;
  submitted: false;
  message: string;
}

const MESSAGE =
  "Not submitted yet. Show this URL to the user: it opens a prefilled public GitHub issue on ferrule-io/ok-fine that they review, edit, and submit with their own GitHub account.";

function present(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Build a prefilled GitHub new-issue URL. Only `title` and `body` are passed: GitHub 404s permissioned
 * parameters such as `labels` for users without triage access.
 */
export function feedbackLink(input: FeedbackInput): FeedbackLink {
  const title = `[${input.type}] ${input.title.trim()}`;
  const lines = [input.body.trim()];
  for (const [heading, value] of [
    ["Expected", input.expected],
    ["Actual", input.actual],
    ["Reproduction", input.reproduction],
  ] as const) {
    const text = present(value);
    if (text) lines.push("", `### ${heading}`, "", text);
  }
  lines.push("", "---", "", `- Type: ${input.type}`, `- ok-fine version: ${VERSION}`);
  const tool = present(input.tool);
  if (tool) lines.push(`- Tool: \`${tool}\``);
  lines.push("", "_Drafted by an AI agent with the ok-fine `submit_feedback` MCP tool._");
  const body = `${lines.join("\n")}\n`;

  const url = `${FEEDBACK_REPOSITORY}/issues/new?${new URLSearchParams({ title, body })}`;
  if (url.length > MAX_FEEDBACK_URL_LENGTH) {
    throw new OkfError(
      "bad_request",
      400,
      `feedback is too long for a GitHub issue link (${url.length} > ${MAX_FEEDBACK_URL_LENGTH} characters); shorten body, expected, actual, or reproduction`,
      { length: url.length, max: MAX_FEEDBACK_URL_LENGTH },
    );
  }
  return { url, title, submitted: false, message: MESSAGE };
}
