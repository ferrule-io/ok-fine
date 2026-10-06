import { describe, expect, it } from "vitest";
import { OkfError } from "../errors.js";
import { VERSION } from "../version.js";
import { feedbackLink } from "./feedback.js";

const FOOTER = "_Drafted by an AI agent with the ok-fine `submit_feedback` MCP tool._\n";

describe("feedbackLink", () => {
  it("builds a title-and-body-only issue URL with every section", () => {
    const link = feedbackLink({
      type: "bug",
      title: " write_concept drops comments ",
      body: "Comments in frontmatter vanish after write_concept.",
      tool: "write_concept",
      expected: "Comments kept",
      actual: "Comments removed",
      reproduction: "1. write a concept with a comment\n2. update it",
    });
    const url = new URL(link.url);
    expect(url.origin + url.pathname).toBe("https://github.com/ferrule-io/ok-fine/issues/new");
    expect([...url.searchParams.keys()]).toEqual(["title", "body"]);
    expect(url.searchParams.get("title")).toBe("[bug] write_concept drops comments");
    expect(link.title).toBe("[bug] write_concept drops comments");
    expect(url.searchParams.get("body")).toBe(
      [
        "Comments in frontmatter vanish after write_concept.",
        "",
        "### Expected",
        "",
        "Comments kept",
        "",
        "### Actual",
        "",
        "Comments removed",
        "",
        "### Reproduction",
        "",
        "1. write a concept with a comment\n2. update it",
        "",
        "---",
        "",
        "- Type: bug",
        `- ok-fine version: ${VERSION}`,
        "- Tool: `write_concept`",
        "",
        FOOTER,
      ].join("\n"),
    );
    expect(link.submitted).toBe(false);
  });

  it("omits absent and blank optional sections", () => {
    const link = feedbackLink({
      type: "general",
      title: "Index is hard to read",
      body: "The generated index groups too much.",
      expected: "   ",
    });
    expect(new URL(link.url).searchParams.get("body")).toBe(
      `The generated index groups too much.\n\n---\n\n- Type: general\n- ok-fine version: ${VERSION}\n\n${FOOTER}`,
    );
  });

  it("rejects feedback whose URL exceeds the GitHub limit", () => {
    let caught: unknown;
    try {
      feedbackLink({ type: "general", title: "Too long feedback", body: "é".repeat(6000) });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(OkfError);
    expect(caught).toMatchObject({ code: "bad_request", status: 400, details: { max: 6000 } });
  });
});
