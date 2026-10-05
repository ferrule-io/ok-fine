import { posix } from "node:path";
import { marked } from "marked";
import { isReservedName } from "./paths.js";

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
const FOOTNOTE_RE = /\[\^([^\]\s]+)\](?!:)/g;

export function extractLinks(body: string, conceptId: string): string[] {
  const tokens = marked.lexer(body);
  const found: string[] = [];
  const seen = new Set<string>();

  marked.walkTokens(tokens, (token) => {
    if (token.type !== "link") {
      return;
    }

    let href = token.href;
    try {
      href = decodeURI(href);
    } catch {
      // ignore URI decode failures
    }

    const hashIdx = href.indexOf("#");
    if (hashIdx !== -1) {
      href = href.slice(0, hashIdx);
    }
    const queryIdx = href.indexOf("?");
    if (queryIdx !== -1) {
      href = href.slice(0, queryIdx);
    }

    if (!href || href.startsWith("//") || SCHEME_RE.test(href)) {
      return;
    }

    let resolved: string;
    if (href.startsWith("/")) {
      resolved = posix.normalize(href.slice(1));
    } else {
      const dir = posix.dirname(conceptId);
      resolved = posix.normalize(posix.join(dir === "." ? "" : dir, href));
    }

    if (resolved === ".." || resolved.startsWith("../") || href.endsWith("/")) {
      return;
    }

    if (!resolved.endsWith(".md")) {
      return;
    }

    const base = posix.basename(resolved);
    if (isReservedName(base)) {
      return;
    }

    const targetId = resolved.slice(0, -3);
    if (!seen.has(targetId)) {
      seen.add(targetId);
      found.push(targetId);
    }
  });

  return found;
}

export function extractFootnoteLabels(body: string): string[] {
  const tokens = marked.lexer(body);
  const labels = new Set<string>();

  marked.walkTokens(tokens, (token) => {
    if (token.type === "code" || token.type === "codespan") {
      return;
    }
    if ("raw" in token && typeof token.raw === "string") {
      const re = new RegExp(FOOTNOTE_RE.source, "g");
      for (const match of token.raw.matchAll(re)) {
        if (match[1]) {
          labels.add(match[1]);
        }
      }
    }
  });

  return Array.from(labels);
}

export function computationBlocks(body: string): number {
  const tokens = marked.lexer(body);
  let inComputation = false;
  let count = 0;

  for (const token of tokens) {
    if (token.type === "heading" && token.depth === 1) {
      if (token.text.trim().toLowerCase() === "computation") {
        inComputation = true;
        continue;
      } else if (inComputation) {
        break;
      }
    }
    if (inComputation && token.type === "code") {
      count++;
    }
  }

  return count;
}

export function hasLegacyCitations(body: string): boolean {
  const tokens = marked.lexer(body);
  for (const token of tokens) {
    if (token.type === "heading" && token.depth === 1 && token.text.trim().toLowerCase() === "citations") {
      return true;
    }
  }
  return false;
}
