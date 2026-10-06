import DOMPurify from "dompurify";
import { Marked, type Token, type Tokens } from "marked";
import { conceptUrl, fileUrl, resolveHref } from "./links.js";
import type { SourceRef } from "./sources.js";

export interface RenderContext {
  project: string;
  conceptId: string;
  title: string;
  sources: SourceRef[];
  outbound: Array<{ id: string; exists: boolean }>;
}

export interface RenderedMarkdown {
  html: string;
  headings: Array<{ id: string; text: string; depth: 2 | 3 }>;
  citations: string[];
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function extractPlainText(tokens?: Token[]): string {
  if (!tokens || tokens.length === 0) {
    return "";
  }
  let text = "";
  for (const t of tokens) {
    if ("tokens" in t && Array.isArray(t.tokens)) {
      text += extractPlainText(t.tokens);
    } else if ("text" in t && typeof t.text === "string") {
      text += t.text;
    }
  }
  return text;
}

export function renderConceptMarkdown(body: string, ctx: RenderContext): RenderedMarkdown {
  const headings: Array<{ id: string; text: string; depth: 2 | 3 }> = [];
  const citations: string[] = [];
  const seenSlugs = new Set<string>();

  // A local map for footnote definitions found in tokens.links
  const footnoteDefs = new Map<string, { href: string; title?: string }>();

  const markedInstance = new Marked({ gfm: true });

  markedInstance.use({
    extensions: [
      {
        name: "citation",
        level: "inline",
        start(src: string) {
          return src.indexOf("[^");
        },
        tokenizer(src: string) {
          const match = /^\[\^([^\]\s]+)\](?!:)/.exec(src);
          if (match?.[1]) {
            return {
              type: "citation",
              raw: match[0],
              label: match[1],
            };
          }
          return undefined;
        },
        renderer(token: Token) {
          if (!("label" in token) || typeof token.label !== "string") {
            return "";
          }
          const label = token.label;
          const matchingSource = ctx.sources.find((s) => s.id === label || s.id.toLowerCase() === label.toLowerCase());

          const canonLabel = matchingSource ? matchingSource.id : label;
          let n = citations.indexOf(canonLabel) + 1;
          if (n === 0) {
            citations.push(canonLabel);
            n = citations.length;
          }

          if (matchingSource) {
            const encodedId = encodeURIComponent(matchingSource.id);
            const escapedId = escapeHtml(matchingSource.id);
            return `<sup class="okf-cite"><a href="#source-${encodedId}" data-okf-cite="${escapedId}">${n}</a></sup>`;
          }

          const def = footnoteDefs.get(label.toLowerCase());
          if (def?.href) {
            return `<sup class="okf-cite"><a href="${escapeHtml(def.href)}" target="_blank" rel="noopener noreferrer">${n}</a></sup>`;
          }

          return `<sup class="okf-cite"><span class="okf-cite-missing" title="Unknown source">${n}</span></sup>`;
        },
      },
    ],
    renderer: {
      heading(token: Tokens.Heading) {
        const depth = token.depth;
        const plainText = extractPlainText(token.tokens).trim();
        const baseSlug =
          plainText
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "") || "heading";

        let slug = baseSlug;
        let counter = 1;
        while (seenSlugs.has(slug)) {
          counter++;
          slug = `${baseSlug}-${counter}`;
        }
        seenSlugs.add(slug);

        if (depth === 2 || depth === 3) {
          headings.push({ id: slug, text: plainText, depth });
        }

        const content = this.parser.parseInline(token.tokens);
        return `<h${depth} id="${slug}"><a class="okf-anchor" href="#${slug}" aria-hidden="true">#</a>${content}</h${depth}>\n`;
      },
      code(token: Tokens.Code) {
        const cleanLang = (token.lang || "").match(/^\S*/)?.[0] ?? "";
        return `<pre class="okf-code" data-lang="${escapeHtml(cleanLang)}"><code>${escapeHtml(token.text)}</code></pre>\n`;
      },
      link(token: Tokens.Link) {
        const href = token.href;
        const titleAttr = token.title ? ` title="${escapeHtml(token.title)}"` : "";
        const text = this.parser.parseInline(token.tokens);
        const resolved = resolveHref(href, ctx.conceptId);

        if (resolved.kind === "concept") {
          const outboundEntry = ctx.outbound.find((o) => o.id === resolved.id);
          const exists = outboundEntry ? outboundEntry.exists : true;
          const url = `/ui${conceptUrl(ctx.project, resolved.id)}${resolved.hash}`;
          const escapedUrl = escapeHtml(url);
          const escapedId = escapeHtml(resolved.id);

          if (!exists) {
            return `<a href="${escapedUrl}" data-okf-internal data-okf-concept="${escapedId}" class="okf-broken" title="Missing concept">${text}</a>`;
          }
          return `<a href="${escapedUrl}" data-okf-internal data-okf-concept="${escapedId}"${titleAttr}>${text}</a>`;
        }

        if (resolved.kind === "file") {
          const url = `/ui${fileUrl(ctx.project, resolved.path)}${resolved.hash}`;
          return `<a href="${escapeHtml(url)}" data-okf-internal${titleAttr}>${text}</a>`;
        }

        if (resolved.kind === "anchor") {
          return `<a href="${escapeHtml(href)}"${titleAttr}>${text}</a>`;
        }

        if (resolved.kind === "external") {
          return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" class="okf-external"${titleAttr}>${text}</a>`;
        }

        return `<span class="okf-broken" title="Broken link">${text}</span>`;
      },
      image(token: Tokens.Image) {
        const href = token.href;
        const alt = escapeHtml(token.text);
        const titleAttr = token.title ? ` title="${escapeHtml(token.title)}"` : "";
        const isExternal =
          href.startsWith("http://") ||
          href.startsWith("https://") ||
          href.startsWith("//") ||
          href.startsWith("data:");

        if (isExternal) {
          return `<img src="${escapeHtml(href)}" alt="${alt}"${titleAttr}>`;
        }
        return `<span class="okf-image-missing">${alt}</span>`;
      },
    },
  });

  const tokens = markedInstance.lexer(body);

  // Collect footnote definitions from tokens.links
  if (tokens.links) {
    for (const [key, val] of Object.entries(tokens.links)) {
      if (key.startsWith("^") && val && typeof val.href === "string") {
        footnoteDefs.set(key.slice(1).toLowerCase(), {
          href: val.href,
          title: typeof val.title === "string" ? val.title : undefined,
        });
      }
    }
  }

  // Drop leading H1 if it matches ctx.title (trimmed, case-insensitive)
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token && token.type === "space") {
      continue;
    }
    if (token && token.type === "heading" && token.depth === 1) {
      const headingText = "text" in token && typeof token.text === "string" ? token.text.trim() : "";
      if (headingText.toLowerCase() === ctx.title.trim().toLowerCase()) {
        tokens.splice(i, 1);
      }
    }
    break;
  }

  const html = DOMPurify.sanitize(markedInstance.parser(tokens), {
    ADD_ATTR: ["target"],
    FORBID_TAGS: ["style", "form", "input", "button", "iframe", "object", "embed"],
    FORBID_ATTR: ["style"],
  });

  return { html, headings, citations };
}
