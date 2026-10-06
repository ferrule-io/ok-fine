import { describe, expect, it } from "vitest";
import { extractLinks } from "../../../src/okf/markdown.js";
import { conceptUrl, fileUrl, resolveHref } from "./links.js";

describe("links", () => {
  it("maintains parity with extractLinks for concept resolution", () => {
    const cases: Array<[conceptId: string, href: string]> = [
      ["a/b", "/x/y.md"],
      ["a/b", "../z.md"],
      ["a/b", "./w.md"],
      ["a/b", "w.md"],
      ["a/b", "/a/../c.md"],
      ["a/b", "../../escape.md"],
      ["a/b", "w.md#sec"],
      ["a/b", "w.md?q=1"],
      ["a/b", "https://e.com/x.md"],
      ["a/b", "//cdn/x.md"],
      ["a/b", "mailto:a@b.c"],
      ["a/b", "/index.md"],
      ["a/b", "d/log.md"],
      ["a/b", "dir/"],
      ["a/b", "%C3%A9t%C3%A9.md"],
      ["overview", "w.md"],
    ];

    for (const [conceptId, href] of cases) {
      const extracted = extractLinks(`[x](${href})`, conceptId);
      const resolved = resolveHref(href, conceptId);
      const resolvedIds = resolved.kind === "concept" ? [resolved.id] : [];
      expect(resolvedIds).toEqual(extracted);
    }
  });

  it("resolves non-concept files and anchors", () => {
    expect(resolveHref("/refs/x.py", "a/b")).toEqual({
      kind: "file",
      path: "refs/x.py",
      hash: "",
    });

    expect(resolveHref("#h", "a")).toEqual({
      kind: "anchor",
      hash: "#h",
    });

    expect(resolveHref("", "a")).toEqual({
      kind: "invalid",
    });
  });

  it("builds router-relative concept and file URLs", () => {
    expect(conceptUrl("demo", "architecture/system")).toBe("/p/demo/c/architecture/system");
    expect(conceptUrl("demo", "/overview")).toBe("/p/demo/c/overview");

    expect(fileUrl("demo", "refs/schema.json")).toBe("/p/demo/f/refs/schema.json");
    expect(fileUrl("demo", "/refs/schema.json")).toBe("/p/demo/f/refs/schema.json");
  });
});
