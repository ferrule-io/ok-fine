import DOMPurify from "dompurify";
import type { HighlighterCore } from "shiki/core";
import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

let highlighterPromise: Promise<HighlighterCore> | null = null;

function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      engine: createJavaScriptRegexEngine(),
      themes: [import("shiki/themes/github-dark-default.mjs"), import("shiki/themes/github-light-default.mjs")],
      langs: [
        import("shiki/langs/typescript.mjs"),
        import("shiki/langs/tsx.mjs"),
        import("shiki/langs/javascript.mjs"),
        import("shiki/langs/jsx.mjs"),
        import("shiki/langs/json.mjs"),
        import("shiki/langs/yaml.mjs"),
        import("shiki/langs/bash.mjs"),
        import("shiki/langs/python.mjs"),
        import("shiki/langs/go.mjs"),
        import("shiki/langs/rust.mjs"),
        import("shiki/langs/sql.mjs"),
        import("shiki/langs/markdown.mjs"),
        import("shiki/langs/diff.mjs"),
        import("shiki/langs/dockerfile.mjs"),
        import("shiki/langs/toml.mjs"),
        import("shiki/langs/html.mjs"),
        import("shiki/langs/css.mjs"),
        import("shiki/langs/java.mjs"),
        import("shiki/langs/ruby.mjs"),
      ],
    });
  }
  return highlighterPromise;
}

export function sanitizeHighlightedHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ["pre", "code", "span", "div"],
    ALLOWED_ATTR: ["class", "style", "tabindex"],
    FORBID_TAGS: ["script", "iframe", "object", "embed", "style", "form", "input", "button", "a"],
    FORBID_ATTR: ["onload", "onerror", "onclick", "onmouseover"],
  });
}
export async function highlight(code: string, lang: string): Promise<string | null> {
  const normalizedLang = lang.trim().toLowerCase();
  if (!normalizedLang) {
    return null;
  }

  const highlighter = await getHighlighter();
  const loaded = highlighter.getLoadedLanguages();
  if (!loaded.includes(normalizedLang)) {
    return null;
  }

  try {
    const raw = highlighter.codeToHtml(code, {
      lang: normalizedLang,
      themes: {
        light: "github-light-default",
        dark: "github-dark-default",
      },
    });
    return sanitizeHighlightedHtml(raw);
  } catch {
    return null;
  }
}
