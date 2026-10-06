import { clsx } from "clsx";
import { useEffect, useState } from "react";
import { CopyButton } from "./CopyButton.js";

export interface CodeBlockProps {
  code: string;
  lang: string | null;
  lineNumbers?: boolean;
  className?: string;
}

export function CodeBlock({ code, lang, lineNumbers = false, className }: CodeBlockProps) {
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!lang) {
      setHighlightedHtml(null);
      return;
    }

    import("../lib/highlight.js")
      .then(({ highlight }) => highlight(code, lang))
      .then((html) => {
        if (!cancelled) {
          setHighlightedHtml(html);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHighlightedHtml(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [code, lang]);

  const lines = code.split("\n");

  return (
    <div className={clsx("relative group", className)}>
      <div className="absolute top-2.5 right-2.5 z-10 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
        <CopyButton value={code} />
      </div>
      {highlightedHtml ? (
        <div
          className={clsx(lineNumbers && "okf-lines")}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: Shiki output from plain text
          dangerouslySetInnerHTML={{ __html: highlightedHtml }}
        />
      ) : (
        <pre className={clsx("okf-code overflow-x-auto", lineNumbers && "okf-lines")}>
          <code>
            {lineNumbers
              ? lines.map((line, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: line index is the canonical identity for static code lines
                  <span key={i} className="line">
                    {line}
                    {i < lines.length - 1 ? "\n" : ""}
                  </span>
                ))
              : code}
          </code>
        </pre>
      )}
    </div>
  );
}
