import { clsx } from "clsx";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import type { ConceptView } from "../../../src/service/knowledge-service.js";
import { readConcept } from "../api/client.js";
import { queryClient, queryKeys } from "../api/queries.js";
import { type RenderedMarkdown, renderConceptMarkdown } from "../lib/markdown.js";
import { readSources } from "../lib/sources.js";
import { LinkPreview } from "./LinkPreview.js";

export interface MarkdownProps {
  project: string;
  concept: ConceptView;
  onHeadings?: (h: RenderedMarkdown["headings"]) => void;
  onCitations?: (labels: string[]) => void;
  className?: string;
}

interface PreviewState {
  conceptId: string;
  concept: ConceptView | null;
  rect: DOMRect;
  targetEl: HTMLElement;
}

export function Markdown({ project, concept, onHeadings, onCitations, className }: MarkdownProps) {
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);

  const [previewState, setPreviewState] = useState<PreviewState | null>(null);
  const hoverTimerRef = useRef<number | undefined>(undefined);
  const isOverPreviewRef = useRef(false);

  const rendered = useMemo(() => {
    return renderConceptMarkdown(concept.body, {
      project,
      conceptId: concept.id,
      title: concept.derived?.title ?? concept.id,
      sources: readSources(concept.frontmatter),
      outbound: concept.links.outbound,
    });
  }, [concept, project]);

  useEffect(() => {
    onHeadings?.(rendered.headings);
    onCitations?.(rendered.citations);
  }, [rendered, onHeadings, onCitations]);

  // Code block syntax highlighting & copy button injection
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run highlighting when rendered HTML changes
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    let cancelled = false;

    const highlightAndInject = async () => {
      const preElements = Array.from(container.querySelectorAll<HTMLPreElement>("pre.okf-code"));
      if (preElements.length === 0) {
        return;
      }

      // Dynamic import required by plan/contract so Shiki remains in a separate lazy chunk
      const { highlight } = await import("../lib/highlight.js");
      if (cancelled) {
        return;
      }

      for (const pre of preElements) {
        if (cancelled) {
          break;
        }
        if (pre.getAttribute("data-okf-processed") === "true") {
          continue;
        }
        pre.setAttribute("data-okf-processed", "true");

        const lang = pre.getAttribute("data-lang") ?? "";
        const codeEl = pre.querySelector("code");
        const code = codeEl?.textContent ?? pre.textContent ?? "";

        let highlightedHtml: string | null = null;
        if (lang) {
          try {
            highlightedHtml = await highlight(code, lang);
          } catch {
            // Leave as plain pre on failure
          }
        }

        if (cancelled) {
          break;
        }

        const wrapper = document.createElement("div");
        wrapper.className = "relative group not-prose my-4";

        if (highlightedHtml) {
          wrapper.innerHTML = highlightedHtml;
          const innerPre = wrapper.querySelector("pre");
          if (innerPre) {
            innerPre.classList.add("overflow-x-auto");
          }
        } else {
          const clone = pre.cloneNode(true) as HTMLPreElement;
          wrapper.appendChild(clone);
        }

        const copyBtn = document.createElement("button");
        copyBtn.type = "button";
        copyBtn.setAttribute("aria-label", "Copy code");
        copyBtn.title = "Copy code";
        copyBtn.className =
          "absolute top-2.5 right-2.5 z-10 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity inline-flex items-center gap-1 rounded-md border border-border bg-surface/80 px-2 py-1 text-xs font-medium text-muted backdrop-blur-xs hover:bg-surface-2 hover:text-fg focus-visible:outline-2 outline-accent-500 cursor-pointer select-none";
        copyBtn.innerHTML =
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';

        copyBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          try {
            await navigator.clipboard.writeText(code);
            copyBtn.innerHTML =
              '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-emerald-500 shrink-0"><polyline points="20 6 9 17 4 12"/></svg>';
            setTimeout(() => {
              copyBtn.innerHTML =
                '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';
            }, 1500);
          } catch {
            // Ignore clipboard errors
          }
        });

        wrapper.appendChild(copyBtn);
        pre.parentNode?.replaceChild(wrapper, pre);
      }
    };

    highlightAndInject();

    return () => {
      cancelled = true;
    };
  }, [rendered.html]);

  // Delegated clicks
  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null;
    if (!target) {
      return;
    }

    const citeLink = target.closest<HTMLAnchorElement>("a[data-okf-cite]");
    if (citeLink) {
      e.preventDefault();
      const label = citeLink.getAttribute("data-okf-cite");
      if (label) {
        const el = document.getElementById(`source-${label}`);
        if (el) {
          el.scrollIntoView({ behavior: "smooth" });
          el.classList.remove("okf-flash");
          void el.offsetWidth;
          el.classList.add("okf-flash");
          setTimeout(() => {
            el.classList.remove("okf-flash");
          }, 1600);
        }
      }
      return;
    }

    const internalLink = target.closest<HTMLAnchorElement>("a[data-okf-internal]");
    if (internalLink) {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
        return;
      }
      e.preventDefault();
      const href = internalLink.getAttribute("href");
      if (href) {
        let dest = href;
        if (dest.startsWith("/ui")) {
          dest = dest.slice(3) || "/";
        }
        if (dest.startsWith("/") && !dest.startsWith("//") && !dest.startsWith("/\\") && !dest.includes("\\")) {
          navigate(dest);
        }
      }
    }
  };

  // Link preview hover
  const handleMouseOver = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null;
    if (!target) {
      return;
    }
    const anchor = target.closest<HTMLAnchorElement>("a[data-okf-concept]");
    if (!anchor) {
      return;
    }
    const conceptId = anchor.getAttribute("data-okf-concept");
    if (!conceptId) {
      return;
    }

    if (previewState?.targetEl === anchor) {
      return;
    }

    clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = window.setTimeout(async () => {
      const rect = anchor.getBoundingClientRect();
      try {
        const data = await queryClient.fetchQuery({
          queryKey: queryKeys.concept(project, conceptId),
          queryFn: () => readConcept(project, conceptId),
        });
        setPreviewState({
          conceptId,
          concept: data,
          rect,
          targetEl: anchor,
        });
      } catch {
        // Concept fetch failed; suppress preview
      }
    }, 250);
  };

  const handleMouseOut = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null;
    if (!target) {
      return;
    }
    const anchor = target.closest<HTMLAnchorElement>("a[data-okf-concept]");
    if (!anchor) {
      return;
    }

    clearTimeout(hoverTimerRef.current);
    setTimeout(() => {
      if (!isOverPreviewRef.current) {
        setPreviewState((current) => (current?.targetEl === anchor ? null : current));
      }
    }, 100);
  };

  // Hide preview on scroll
  useEffect(() => {
    const handleScroll = () => {
      clearTimeout(hoverTimerRef.current);
      setPreviewState(null);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", handleScroll);
      clearTimeout(hoverTimerRef.current);
    };
  }, []);

  return (
    <div className="relative">
      {/* biome-ignore lint/a11y/noStaticElementInteractions: delegated link navigation and hover preview */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: delegated click on anchor tags */}
      {/* biome-ignore lint/a11y/useKeyWithMouseEvents: delegated hover preview on anchor tags */}
      <div
        ref={containerRef}
        onClick={handleClick}
        onMouseOver={handleMouseOver}
        onMouseOut={handleMouseOut}
        className={clsx("prose prose-zinc dark:prose-invert max-w-3xl", className)}
        // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized by DOMPurify
        dangerouslySetInnerHTML={{ __html: rendered.html }}
      />

      {previewState && (
        <LinkPreview
          concept={previewState.concept}
          conceptId={previewState.conceptId}
          targetRect={previewState.rect}
          onMouseEnter={() => {
            isOverPreviewRef.current = true;
          }}
          onMouseLeave={() => {
            isOverPreviewRef.current = false;
            setPreviewState(null);
          }}
        />
      )}
    </div>
  );
}
