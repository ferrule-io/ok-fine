import type { ConceptView } from "../../../src/service/knowledge-service.js";
import { StaleBadge, StatusBadge, TrustBadge } from "./Badges.js";
import { Skeleton } from "./Skeleton.js";
import { TypeIcon } from "./TypeIcon.js";

export interface LinkPreviewProps {
  concept: ConceptView | null;
  conceptId: string;
  targetRect: DOMRect;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

export function LinkPreview({ concept, conceptId, targetRect, onMouseEnter, onMouseLeave }: LinkPreviewProps) {
  const top = targetRect.bottom + 6;
  const left = Math.max(12, Math.min(targetRect.left, window.innerWidth - 332));

  return (
    <div
      role="tooltip"
      style={{ top, left }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className="fixed z-50 w-80 max-w-[calc(100vw-24px)] rounded-xl border border-border-strong bg-surface/95 p-3.5 shadow-xl backdrop-blur-md transition-all duration-150"
    >
      {concept ? (
        <>
          <div className="flex items-start gap-2">
            <TypeIcon type={concept.derived?.type ?? null} className="mt-0.5 shrink-0" size={16} />
            <div className="min-w-0 flex-1 font-medium text-sm text-fg line-clamp-2 leading-snug">
              {concept.derived?.title ?? concept.id}
            </div>
          </div>

          {concept.derived?.description && (
            <p className="mt-1.5 text-xs text-muted line-clamp-2 leading-relaxed">{concept.derived.description}</p>
          )}

          <div className="mt-2.5 flex flex-wrap items-center gap-1.5 pt-1.5 border-t border-border/50">
            {concept.derived?.status && <StatusBadge status={concept.derived.status} />}
            {concept.derived?.trustTier && <TrustBadge tier={concept.derived.trustTier} />}
            {concept.derived?.stale && <StaleBadge />}
          </div>
        </>
      ) : (
        <div className="space-y-2">
          <div className="font-mono text-xs text-muted truncate">{conceptId}</div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-4 rounded-full" />
            <Skeleton className="h-4 w-40 rounded-sm" />
          </div>
          <Skeleton className="h-3 w-full rounded-sm" />
          <Skeleton className="h-3 w-3/4 rounded-sm" />
          <div className="flex gap-1 pt-1">
            <Skeleton className="h-4 w-12 rounded-full" />
            <Skeleton className="h-4 w-16 rounded-full" />
          </div>
        </div>
      )}
    </div>
  );
}
