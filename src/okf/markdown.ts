import { posix } from "node:path";
import { marked } from "marked";
import { isReservedName, PROJECT_RE, SEGMENT_RE } from "./paths.js";

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
const FOOTNOTE_RE = /\[\^([^\]\s]+)\](?!:)/g;
export interface CrossProjectLink {
  project: string;
  id: string;
}

export function parseCrossProjectTarget(rawHref: string): CrossProjectLink | null {
  if (!rawHref) {
    return null;
  }
  let href = rawHref;
  try {
    href = decodeURI(href);
  } catch {
    // ignore URI decode failures
  }

  if (href.includes("\\")) {
    return null;
  }

  const trimmed = href.trim();
  if (!trimmed.toLowerCase().startsWith("okf://")) {
    return null;
  }

  let withoutHash = trimmed;
  const hashIdx = withoutHash.indexOf("#");
  if (hashIdx !== -1) {
    withoutHash = withoutHash.slice(0, hashIdx);
  }
  const queryIdx = withoutHash.indexOf("?");
  if (queryIdx !== -1) {
    withoutHash = withoutHash.slice(0, queryIdx);
  }

  const rest = withoutHash.slice(6);
  const slashIdx = rest.indexOf("/");
  if (slashIdx === -1) {
    return null;
  }

  const project = rest.slice(0, slashIdx);
  if (!PROJECT_RE.test(project)) {
    return null;
  }

  let target = rest.slice(slashIdx + 1);
  if (target.endsWith(".md")) {
    target = target.slice(0, -3);
  }
  if (target.length === 0 || target.length > 512) {
    return null;
  }

  const segments = target.split("/");
  if (segments.length > 12) {
    return null;
  }

  for (const seg of segments) {
    if (!SEGMENT_RE.test(seg)) {
      return null;
    }
  }

  const lastSeg = segments[segments.length - 1];
  if (!lastSeg) {
    return null;
  }
  const lastLower = lastSeg.toLowerCase();
  if (lastLower === "index" || lastLower === "log") {
    return null;
  }

  return { project, id: segments.join("/") };
}

export function extractCrossProjectLinks(body: string): CrossProjectLink[] {
  const tokens = marked.lexer(body);
  const found: CrossProjectLink[] = [];
  const seen = new Set<string>();

  marked.walkTokens(tokens, (token) => {
    if (token.type !== "link" || token.raw.startsWith("[^")) {
      return;
    }

    const target = parseCrossProjectTarget(token.href);
    if (!target) {
      return;
    }

    const key = `${target.project}/${target.id}`;
    if (!seen.has(key)) {
      seen.add(key);
      found.push(target);
    }
  });

  return found;
}

export function extractLinks(body: string, conceptId: string): string[] {
  const tokens = marked.lexer(body);
  const found: string[] = [];
  const seen = new Set<string>();

  marked.walkTokens(tokens, (token) => {
    // marked has no footnote support: `[^id]` plus a `[^id]: x.md` definition lexes as a reference link.
    if (token.type !== "link" || token.raw.startsWith("[^")) {
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
