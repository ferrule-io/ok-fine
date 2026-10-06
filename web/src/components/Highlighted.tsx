import type { ReactNode } from "react";

export interface HighlightedProps {
  text: string;
  query?: string;
  className?: string;
}

export function Highlighted({ text, query, className }: HighlightedProps): ReactNode {
  if (!text) {
    return null;
  }

  if (!query?.trim()) {
    return <span className={className}>{text}</span>;
  }

  const rawTerms = query
    .trim()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  // Deduplicate terms while preserving order
  const terms: string[] = [];
  const seen: Record<string, true> = {};
  for (const t of rawTerms) {
    const lower = t.toLowerCase();
    if (!seen[lower]) {
      seen[lower] = true;
      terms.push(t);
    }
  }
  terms.sort((a, b) => b.length - a.length);

  if (terms.length === 0) {
    return <span className={className}>{text}</span>;
  }

  const escapedTerms = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`(${escapedTerms.join("|")})`, "gi");
  const parts = text.split(pattern);

  return (
    <span className={className}>
      {parts.map((part, index) => {
        const isMatch = terms.some((term) => term.toLowerCase() === part.toLowerCase());
        if (isMatch) {
          return (
            <mark
              // biome-ignore lint/suspicious/noArrayIndexKey: parts are static during a render pass
              key={index}
              className="rounded-xs bg-amber-400/25 px-0.5 font-medium text-fg dark:bg-amber-400/35"
            >
              {part}
            </mark>
          );
        }
        return part;
      })}
    </span>
  );
}
