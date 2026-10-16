// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { sanitizeDiagramSvg } from "./diagram.js";
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

  it("renders cross-project links in Markdown with data-okf-project and UI route", () => {
    const rendered = renderConceptMarkdown("See [Tier Policy](okf://org/glossary/tier#sec).", {
      project: "support",
      conceptId: "guide",
      title: "Support Guide",
      sources: [],
      outbound: [{ project: "org", id: "glossary/tier", exists: true }],
    });

    expect(rendered.html).toContain('href="/ui/p/org/c/glossary/tier#sec"');
    expect(rendered.html).toContain("data-okf-internal");
    expect(rendered.html).toContain('data-okf-concept="glossary/tier"');
    expect(rendered.html).toContain('data-okf-project="org"');
    expect(rendered.html).not.toContain("okf-broken");

    // Missing target
    const renderedMissing = renderConceptMarkdown("See [Missing](okf://org/missing).", {
      project: "support",
      conceptId: "guide",
      title: "Support Guide",
      sources: [],
      outbound: [{ project: "org", id: "missing", exists: false }],
    });

    expect(renderedMissing.html).toContain('href="/ui/p/org/c/missing"');
    expect(renderedMissing.html).toContain('class="okf-broken"');
    expect(renderedMissing.html).toContain('title="Missing concept"');
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

describe("sanitizeDiagramSvg", () => {
  it("preserves safe SVG elements, styles, markers, and text content", () => {
    const safeSvg =
      '<svg id="d1" class="mermaid" width="100%" height="100%"><style>.actor { stroke: #333; fill: #fff; }</style><defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="5" refY="5" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="#000"></path></marker></defs><g marker-end="url(#arrow)"><path d="M 10 10 L 50 50"></path><text x="10" y="20">Alice -&gt; Bob</text></g></svg>';
    const sanitized = sanitizeDiagramSvg(safeSvg);
    expect(sanitized).toContain("<svg");
    expect(sanitized).toContain('id="d1"');
    expect(sanitized).toContain('class="mermaid"');
    expect(sanitized).toContain("<style>.actor { stroke: #333; fill: #fff; }</style>");
    expect(sanitized).toContain('<marker id="arrow"');
    expect(sanitized).toContain('marker-end="url(#arrow)"');
    expect(sanitized).toContain('<path d="M 10 10 L 50 50">');
    expect(sanitized).toContain("<text");
    expect(sanitized).toContain("Alice -&gt; Bob");
  });

  it("strips script, foreignObject, use, and animation tags", () => {
    const maliciousSvg =
      '<svg><script>alert("xss")</script><foreignObject><body><iframe src="evil.html"></iframe></body></foreignObject><use href="#evil" xlink:href="#evil2"></use><animate attributeName="x" from="0" to="10"></animate><set attributeName="fill" to="red"></set><animateMotion path="M 0 0 L 10 10"></animateMotion><animateTransform type="rotate"></animateTransform><g><text>Safe</text></g></svg>';
    const sanitized = sanitizeDiagramSvg(maliciousSvg);
    expect(sanitized).not.toContain("<script");
    expect(sanitized).not.toContain("alert");
    expect(sanitized).not.toContain("<foreignObject");
    expect(sanitized).not.toContain("<foreignobject");
    expect(sanitized).not.toContain("<iframe");
    expect(sanitized).not.toContain("<use");
    expect(sanitized).not.toContain("<animate");
    expect(sanitized).not.toContain("<set");
    expect(sanitized).not.toContain("<animateMotion");
    expect(sanitized).not.toContain("<animatemotion");
    expect(sanitized).not.toContain("<animateTransform");
    expect(sanitized).not.toContain("<animatetransform");
    expect(sanitized).toContain("<text>Safe</text>");
  });

  it("strips event handler attributes and href / xlink:href to javascript: and external URLs", () => {
    const exploitSvg =
      '<svg onload="alert(1)"><g onclick="alert(2)"><text onmouseover="alert(3)">Target</text><a href="javascript:alert(4)" xlink:href="https://evil.com/leak"><image href="https://evil.com/img.png" xlink:href="javascript:alert(5)"></image></a></g></svg>';
    const sanitized = sanitizeDiagramSvg(exploitSvg);
    expect(sanitized).not.toContain("onload=");
    expect(sanitized).not.toContain("onclick=");
    expect(sanitized).not.toContain("onmouseover=");
    expect(sanitized).not.toContain("alert");
    expect(sanitized).not.toContain("href=");
    expect(sanitized).not.toContain("xlink:href=");
    expect(sanitized).not.toContain("<a");
    expect(sanitized).toContain("Target");
  });

  it("returns an empty string when the input has no svg element", () => {
    expect(sanitizeDiagramSvg("")).toBe("");
    expect(sanitizeDiagramSvg("<p>Not a diagram</p>")).toBe("");
    expect(sanitizeDiagramSvg("<script>alert(1)</script>")).toBe("");
    expect(sanitizeDiagramSvg("plain text")).toBe("");
  });
});
