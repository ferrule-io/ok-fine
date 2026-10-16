import DOMPurify from "dompurify";
import type { MermaidConfig } from "mermaid";

const MERMAID_SECURE_KEYS = [
  "secure",
  "securityLevel",
  "startOnLoad",
  "maxTextSize",
  "suppressErrorRendering",
  "maxEdges",
  "themeCSS",
  "themeVariables",
  "fontFamily",
  "altFontFamily",
  "htmlLabels",
  "flowchart",
];

export function sanitizeDiagramSvg(svg: string): string {
  if (!svg || typeof svg !== "string") {
    return "";
  }

  const sanitized = DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: ["style"],
    ADD_ATTR: ["style", "class", "id", "marker-start", "marker-mid", "marker-end"],
    FORBID_TAGS: [
      "script",
      "foreignobject",
      "foreignObject",
      "use",
      "animate",
      "set",
      "animatemotion",
      "animateMotion",
      "animatetransform",
      "animateTransform",
      "iframe",
      "object",
      "embed",
      "a",
    ],
    FORBID_ATTR: ["href", "xlink:href"],
  });

  if (!/<svg[\s>/]/i.test(sanitized)) {
    return "";
  }

  return sanitized;
}

let renderQueue: Promise<unknown> = Promise.resolve();
let idCounter = 0;

export async function renderMermaid(code: string, dark: boolean): Promise<string | null> {
  const doRender = async (): Promise<string | null> => {
    if (!code || typeof code !== "string" || !code.trim()) {
      return null;
    }

    idCounter += 1;
    const id = `okf-mermaid-${Date.now().toString(36)}-${idCounter.toString(36)}`;

    try {
      // Dynamic import required so mermaid remains in a separate lazy chunk and out of the main bundle
      const { default: mermaid } = await import("mermaid");
      const config: MermaidConfig = {
        startOnLoad: false,
        securityLevel: "strict",
        theme: dark ? "dark" : "default",
        htmlLabels: false,
        flowchart: { htmlLabels: false },
        suppressErrorRendering: true,
        secure: MERMAID_SECURE_KEYS,
      };

      mermaid.initialize(config);

      const { svg } = await mermaid.render(id, code);
      const sanitized = sanitizeDiagramSvg(svg);
      if (!sanitized) {
        if (typeof document !== "undefined") {
          document.getElementById(`d${id}`)?.remove();
          document.getElementById(id)?.remove();
        }
        return null;
      }
      return sanitized;
    } catch {
      if (typeof document !== "undefined") {
        document.getElementById(`d${id}`)?.remove();
        document.getElementById(id)?.remove();
      }
      return null;
    }
  };

  const nextPromise = renderQueue.then(doRender, doRender);
  renderQueue = nextPromise.catch(() => {});
  return nextPromise;
}
