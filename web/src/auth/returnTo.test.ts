import { describe, expect, it } from "vitest";
import { sanitizeReturnTo } from "./returnTo.js";

describe("sanitizeReturnTo", () => {
  it("allows safe router-relative and /ui/ prefixed paths", () => {
    expect(sanitizeReturnTo("/ui/p/my-project")).toBe("/p/my-project");
    expect(sanitizeReturnTo("/p/my-project")).toBe("/p/my-project");
    expect(sanitizeReturnTo("/ui")).toBe("/");
    expect(sanitizeReturnTo("/ui/")).toBe("/");
    expect(sanitizeReturnTo("/")).toBe("/");
    expect(sanitizeReturnTo("/ui/search?q=test#top")).toBe("/search?q=test#top");
    expect(sanitizeReturnTo("/search?q=test#top")).toBe("/search?q=test#top");
    expect(sanitizeReturnTo("/ui/p/proj/c/architecture/auth")).toBe("/p/proj/c/architecture/auth");
    expect(sanitizeReturnTo("/p/proj/f/src/index.ts")).toBe("/p/proj/f/src/index.ts");
    expect(sanitizeReturnTo("   /ui/p/proj   ")).toBe("/p/proj");
  });

  it("rejects protocol-relative and external URLs", () => {
    expect(sanitizeReturnTo("//evil.com")).toBe("/");
    expect(sanitizeReturnTo("//evil.com/ui/")).toBe("/");
    expect(sanitizeReturnTo("///evil.com")).toBe("/");
    expect(sanitizeReturnTo("https://evil.com")).toBe("/");
    expect(sanitizeReturnTo("https://evil.com/ui/p/test")).toBe("/");
    expect(sanitizeReturnTo("http://evil.com/ui/p/test")).toBe("/");
    expect(sanitizeReturnTo("http://127.0.0.1:9999/ui/")).toBe("/");
  });

  it("rejects backslash variants and UNC paths", () => {
    expect(sanitizeReturnTo("/\\evil.com")).toBe("/");
    expect(sanitizeReturnTo("\\\\evil.com")).toBe("/");
    expect(sanitizeReturnTo("/\\/evil.com")).toBe("/");
    expect(sanitizeReturnTo("/ui/\\evil.com")).toBe("/");
    expect(sanitizeReturnTo("/ui/\\\\evil.com")).toBe("/");
    expect(sanitizeReturnTo("\\")).toBe("/");
  });

  it("rejects non-http dangerous schemes", () => {
    expect(sanitizeReturnTo("javascript:alert(1)")).toBe("/");
    expect(sanitizeReturnTo("javascript:alert(document.domain)")).toBe("/");
    expect(sanitizeReturnTo("data:text/html,<script>alert(1)</script>")).toBe("/");
    expect(sanitizeReturnTo("vbscript:alert(1)")).toBe("/");
    expect(sanitizeReturnTo("blob:https://evil.com/1234")).toBe("/");
  });

  it("rejects URL-encoded slash and backslash bypass attempts", () => {
    expect(sanitizeReturnTo("/%2f%2fevil.com")).toBe("/");
    expect(sanitizeReturnTo("/%2F%2Fevil.com")).toBe("/");
    expect(sanitizeReturnTo("/%5cevil.com")).toBe("/");
    expect(sanitizeReturnTo("/%5Cevil.com")).toBe("/");
    expect(sanitizeReturnTo("/%252f%252fevil.com")).toBe("/");
    expect(sanitizeReturnTo("/ui/%2f%2fevil.com")).toBe("/");
    expect(sanitizeReturnTo("/ui/%5cevil.com")).toBe("/");
    expect(sanitizeReturnTo("/ui/%5C%5Cevil.com")).toBe("/");
  });

  it("rejects server-only endpoints not part of the web UI", () => {
    expect(sanitizeReturnTo("/api/v1/projects")).toBe("/");
    expect(sanitizeReturnTo("/healthz")).toBe("/");
    expect(sanitizeReturnTo("/mcp")).toBe("/");
    expect(sanitizeReturnTo("/.well-known/oauth-authorization-server")).toBe("/");
  });

  it("rejects the callback path to prevent auth redirect loops", () => {
    expect(sanitizeReturnTo("/ui/callback")).toBe("/");
    expect(sanitizeReturnTo("/callback")).toBe("/");
    expect(sanitizeReturnTo("/ui/callback?code=abc&state=xyz")).toBe("/");
    expect(sanitizeReturnTo("/callback?code=abc&state=xyz")).toBe("/");
  });

  it("rejects control characters and malformed non-string inputs", () => {
    expect(sanitizeReturnTo("\x00/ui/p/proj")).toBe("/");
    expect(sanitizeReturnTo("\r\n/ui/p/proj")).toBe("/");
    expect(sanitizeReturnTo("")).toBe("/");
    expect(sanitizeReturnTo("   ")).toBe("/");
    expect(sanitizeReturnTo(null)).toBe("/");
    expect(sanitizeReturnTo(undefined)).toBe("/");
    expect(sanitizeReturnTo(12345)).toBe("/");
    expect(sanitizeReturnTo({})).toBe("/");
  });

  it("accepts same-origin absolute URLs when baseOrigin matches", () => {
    expect(sanitizeReturnTo("https://okf.test/ui/p/test", "https://okf.test")).toBe("/p/test");
    expect(sanitizeReturnTo("https://evil.com/ui/p/test", "https://okf.test")).toBe("/");
    expect(sanitizeReturnTo("https://okf.test.evil.com/ui/p/test", "https://okf.test")).toBe("/");
  });
});
