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

  it("rejects dangerous URL schemes and variants as invalid", () => {
    const unsafeHrefs = [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "  javascript:alert(1)",
      "\tjavascript:alert(1)",
      "\njavascript:alert(1)",
      "\r\njavascript:alert(1)",
      "jav&#x09;ascript:alert(1)",
      "javascript&colon;alert(1)",
      "vbscript:msgbox(1)",
      "VBScript:msgbox(1)",
      "data:text/html,<script>alert(1)</script>",
      "data:image/svg+xml,<svg onload=alert(1)>",
      "file:///etc/passwd",
      "blob:https://example.com/uuid",
      "about:blank",
    ];

    for (const href of unsafeHrefs) {
      expect(resolveHref(href, "a/b")).toEqual({ kind: "invalid" });
    }
  });

  it("rejects backslash evasion and traversal patterns as invalid", () => {
    const backslashHrefs = [
      "\\\\attacker.com\\evil",
      "/\\attacker.com",
      "\\attacker.com",
      "..\\..\\evil.md",
      "/..\\evil.md",
      "a/..\\b.md",
      "///evil.com",
      "//",
      "//attacker.com\\evil",
      "%5c%5cattacker.com",
    ];

    for (const href of backslashHrefs) {
      expect(resolveHref(href, "a/b")).toEqual({ kind: "invalid" });
    }
  });

  it("accepts safe external URLs", () => {
    expect(resolveHref("https://example.com", "a")).toEqual({
      kind: "external",
      href: "https://example.com",
    });
    expect(resolveHref("http://example.com/foo?bar=1#baz", "a")).toEqual({
      kind: "external",
      href: "http://example.com/foo?bar=1#baz",
    });
    expect(resolveHref("mailto:alice@example.com", "a")).toEqual({
      kind: "external",
      href: "mailto:alice@example.com",
    });
    expect(resolveHref("tel:+1234567890", "a")).toEqual({
      kind: "external",
      href: "tel:+1234567890",
    });
    expect(resolveHref("//cdn.example.com/asset.js", "a")).toEqual({
      kind: "external",
      href: "//cdn.example.com/asset.js",
    });
  });
  it("builds router-relative concept and file URLs", () => {
    expect(conceptUrl("demo", "architecture/system")).toBe("/p/demo/c/architecture/system");
    expect(conceptUrl("demo", "/overview")).toBe("/p/demo/c/overview");

    expect(fileUrl("demo", "refs/schema.json")).toBe("/p/demo/f/refs/schema.json");
    expect(fileUrl("demo", "/refs/schema.json")).toBe("/p/demo/f/refs/schema.json");
  });

  it("resolves okf:// cross-project concept links", () => {
    expect(resolveHref("okf://org/glossary/tier", "a/b")).toEqual({
      kind: "concept",
      project: "org",
      id: "glossary/tier",
      hash: "",
    });
    expect(resolveHref("okf://org/glossary/tier.md#section", "a/b")).toEqual({
      kind: "concept",
      project: "org",
      id: "glossary/tier",
      hash: "#section",
    });
    expect(resolveHref("okf://org/glossary/tier?ref=1#section", "a/b")).toEqual({
      kind: "concept",
      project: "org",
      id: "glossary/tier",
      hash: "#section",
    });
    expect(resolveHref("okf://org/tier", "a/b")).toEqual({
      kind: "concept",
      project: "org",
      id: "tier",
      hash: "",
    });
    expect(resolveHref("okf://org/tier.md", "a/b")).toEqual({
      kind: "concept",
      project: "org",
      id: "tier",
      hash: "",
    });
  });

  it("rejects invalid okf:// cross-project links as invalid", () => {
    const invalidCrossProject = [
      "okf://org/../tier",
      "okf://org/tier/..",
      "okf://../tier",
      "okf://Org/tier",
      "okf://-org/tier",
      "okf://org_name/tier",
      "okf://org//tier",
      "okf://org/tier/",
      "okf://org/index",
      "okf://org/index.md",
      "okf://org/log",
      "okf://org/log.md",
      "okf://org/sub/log",
      "okf://org\\tier",
    ];

    for (const href of invalidCrossProject) {
      expect(resolveHref(href, "a/b")).toEqual({ kind: "invalid" });
    }
  });
});
