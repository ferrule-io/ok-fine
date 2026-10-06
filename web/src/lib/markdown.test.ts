// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { sanitizeHighlightedHtml } from "./highlight.js";
import { type RenderContext, renderConceptMarkdown, sanitizeMarkdownHtml } from "./markdown.js";
import { readSources } from "./sources.js";

const dummyCtx: RenderContext = {
  project: "testproj",
  conceptId: "overview",
  title: "Overview",
  sources: [],
  outbound: [],
};

describe("renderConceptMarkdown security", () => {
  it("sanitizes script tags from markdown body", () => {
    const rendered = renderConceptMarkdown("<script>alert('xss')</script>Hello", dummyCtx);
    expect(rendered.html).not.toContain("<script>");
    expect(rendered.html).not.toContain("alert(");
    expect(rendered.html).toContain("Hello");
  });

  it("neutralizes javascript: and data: links", () => {
    const renderedJs = renderConceptMarkdown("[click me](javascript:alert(1))", dummyCtx);
    expect(renderedJs.html).not.toContain('href="javascript:');
    expect(renderedJs.html).toContain("okf-broken");

    const renderedData = renderConceptMarkdown("[click me](data:text/html,<script>alert(1)</script>)", dummyCtx);
    expect(renderedData.html).not.toContain('href="data:');
    expect(renderedData.html).toContain("okf-broken");

    const renderedEntity = renderConceptMarkdown("[click me](jav&#x09;ascript:alert(1))", dummyCtx);
    expect(renderedEntity.html).not.toContain('href="jav');
    expect(renderedEntity.html).not.toContain('href="javascript');
  });

  it("enforces rel='noopener noreferrer' and target='_blank' on external links", () => {
    const rendered = renderConceptMarkdown("[docs](https://example.com/docs)", dummyCtx);
    expect(rendered.html).toContain('href="https://example.com/docs"');
    expect(rendered.html).toContain('target="_blank"');
    expect(rendered.html).toContain('rel="noopener noreferrer"');
  });

  it("blocks remote image loads and renders a placeholder link", () => {
    const renderedHttp = renderConceptMarkdown("![tracking pixel](https://tracker.com/pixel.png)", dummyCtx);
    expect(renderedHttp.html).not.toContain("<img");
    expect(renderedHttp.html).toContain("okf-image-blocked");
    expect(renderedHttp.html).toContain('href="https://tracker.com/pixel.png"');
    expect(renderedHttp.html).toContain('rel="noopener noreferrer"');

    const renderedProto = renderConceptMarkdown("![leak](//evil.com/img.png)", dummyCtx);
    expect(renderedProto.html).not.toContain("<img");
    expect(renderedProto.html).toContain("okf-image-blocked");
  });

  it("allows safe raster data URLs and same-origin image paths", () => {
    const pngBase64 =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    const renderedPng = renderConceptMarkdown(`![raster](${pngBase64})`, dummyCtx);
    expect(renderedPng.html).toContain(`<img src="${pngBase64}"`);

    const renderedLocal = renderConceptMarkdown("![icon](/favicon.svg)", dummyCtx);
    expect(renderedLocal.html).toContain('<img src="/favicon.svg"');
  });

  it("blocks svg data URLs from rendering as img src", () => {
    const svgData = "data:image/svg+xml;base64,PHN2Zz48c2NyaXB0PmFsZXJ0KDEpPC9zY3JpcHQ+PC9zdmc+";
    const rendered = renderConceptMarkdown(`![svg](${svgData})`, dummyCtx);
    expect(rendered.html).not.toContain("<img");
    expect(rendered.html).toContain("okf-image-missing");
  });

  it("sanitizes raw HTML img tags via DOMPurify hooks", () => {
    const htmlWithRemoteImg = '<img src="https://tracker.com/pixel.png" alt="tracker">';
    const sanitized = sanitizeMarkdownHtml(htmlWithRemoteImg);
    expect(sanitized).not.toContain('src="https://tracker.com/pixel.png"');
    expect(sanitized).toContain('data-okf-blocked-src="true"');

    const htmlWithSvgData = '<img src="data:image/svg+xml,<svg onload=alert(1)>" alt="svg">';
    const sanitizedSvg = sanitizeMarkdownHtml(htmlWithSvgData);
    expect(sanitizedSvg).not.toContain('src="data:image/svg+xml');
    expect(sanitizedSvg).toContain('data-okf-blocked-src="true"');
  });

  it("prevents script execution in inline SVG", () => {
    const svgExploit = '<svg><script>alert(1)</script><circle r="10"/></svg>';
    const rendered = renderConceptMarkdown(svgExploit, dummyCtx);
    expect(rendered.html).not.toContain("<script>");
    expect(rendered.html).not.toContain("alert(1)");

    const svgEvent = '<svg onload="alert(1)"><rect width="10" height="10"/></svg>';
    const renderedEvent = renderConceptMarkdown(svgEvent, dummyCtx);
    expect(renderedEvent.html).not.toContain("onload=");
  });

  it("sanitizes footnote citation links", () => {
    const maliciousFootnote = "[^hack]\n\n[^hack]: javascript:alert(document.domain)";
    const rendered = renderConceptMarkdown(maliciousFootnote, dummyCtx);
    expect(rendered.html).not.toContain('href="javascript:');
    expect(rendered.html).toContain("okf-cite-missing");

    const validFootnote = "[^doc]\n\n[^doc]: https://example.com/doc";
    const renderedValid = renderConceptMarkdown(validFootnote, dummyCtx);
    expect(renderedValid.html).toContain('href="https://example.com/doc"');
    expect(renderedValid.html).toContain('target="_blank"');
    expect(renderedValid.html).toContain('rel="noopener noreferrer"');
  });
});

describe("sanitizeHighlightedHtml", () => {
  it("preserves Shiki span styles while stripping dangerous tags and event handlers", () => {
    const shikiHtml =
      '<pre class="shiki github-dark" style="background-color:#24292e"><code><span class="line"><span style="color:#F97587">const</span></span></code></pre>';
    const sanitized = sanitizeHighlightedHtml(shikiHtml);
    expect(sanitized).toContain("background-color:#24292e");
    expect(sanitized).toContain("color:#F97587");
    expect(sanitized).toContain("const");

    const maliciousShiki =
      '<pre class="shiki"><code><span class="line"><span onclick="alert(1)"><script>alert(2)</script>evil</span></span></code></pre>';
    const cleaned = sanitizeHighlightedHtml(maliciousShiki);
    expect(cleaned).not.toContain("onclick=");
    expect(cleaned).not.toContain("<script>");
    expect(cleaned).toContain("evil");
  });
});

describe("readSources security", () => {
  it("rejects malicious commits and invalid URLs", () => {
    const sources = readSources({
      sources: [
        {
          id: "s1",
          resource: "github.com/org/repo/file.ts",
          commit: 'HEAD/../../../../evil"<script>',
        },
        {
          id: "s2",
          resource: "javascript:alert(1)",
        },
        {
          id: "s3",
          resource: "https://example.com/safe",
          commit: "abcdef123456",
        },
      ],
    });

    const s1 = sources.find((s) => s.id === "s1");
    expect(s1).toBeDefined();
    expect(s1?.commit).toBeUndefined();
    expect(s1?.url).toBe("https://github.com/org/repo/blob/HEAD/file.ts");

    const s2 = sources.find((s) => s.id === "s2");
    expect(s2).toBeDefined();
    expect(s2?.url).toBeNull();

    const s3 = sources.find((s) => s.id === "s3");
    expect(s3).toBeDefined();
    expect(s3?.url).toBe("https://example.com/safe");
    expect(s3?.commit).toBe("abcdef123456");
  });
});
