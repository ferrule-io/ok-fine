import { clsx } from "clsx";
import { type MouseEvent, useEffect, useState } from "react";

export interface TocHeading {
  id: string;
  text: string;
  depth: 2 | 3;
}

export interface TocProps {
  headings: TocHeading[];
  className?: string;
}

export function Toc({ headings, className }: TocProps) {
  const [activeId, setActiveId] = useState<string>(headings[0]?.id ?? "");

  useEffect(() => {
    if (headings.length < 3) {
      return;
    }

    const headingElements = headings
      .map((h) => document.getElementById(h.id))
      .filter((el): el is HTMLElement => el !== null);

    if (headingElements.length === 0) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
          }
        }
      },
      {
        rootMargin: "0px 0px -70% 0px",
        threshold: [0, 1],
      },
    );

    for (const el of headingElements) {
      observer.observe(el);
    }

    return () => {
      observer.disconnect();
    };
  }, [headings]);

  if (headings.length < 3) {
    return null;
  }

  const handleClick = (e: MouseEvent<HTMLAnchorElement>, id: string) => {
    e.preventDefault();
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth" });
      setActiveId(id);
      window.history.replaceState(null, "", `#${id}`);
    }
  };

  return (
    <nav aria-label="Table of contents" className={clsx("space-y-2", className)}>
      <div className="text-xs font-semibold uppercase tracking-wider text-muted">On this page</div>
      <ul className="space-y-1 border-l border-border text-xs">
        {headings.map((h) => {
          const isActive = activeId === h.id;
          return (
            <li key={h.id} className={h.depth === 3 ? "pl-5" : "pl-3"}>
              <a
                href={`#${h.id}`}
                onClick={(e) => handleClick(e, h.id)}
                className={clsx(
                  "block py-0.5 transition-colors line-clamp-1",
                  isActive
                    ? "-ml-px border-l-2 border-accent-500 pl-1 font-medium text-accent-500"
                    : "text-muted hover:text-fg",
                )}
              >
                {h.text}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
