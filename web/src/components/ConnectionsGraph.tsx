import { clsx } from "clsx";
import { motion } from "motion/react";
import { useNavigate } from "react-router";
import { conceptUrl } from "../lib/links.js";

export interface OutboundLink {
  id: string;
  exists: boolean;
}

export interface ConnectionsGraphProps {
  project: string;
  conceptId: string;
  inbound: string[];
  outbound: OutboundLink[];
  className?: string;
}

const TRUNCATE_LEN = 14;

export function ConnectionsGraph({ project, conceptId, inbound, outbound, className }: ConnectionsGraphProps) {
  const navigate = useNavigate();

  if (inbound.length === 0 && outbound.length === 0) {
    return (
      <div
        className={clsx(
          "rounded-xl border border-border bg-surface-2/40 p-4 text-center text-xs text-muted italic",
          className,
        )}
      >
        No connections yet
      </div>
    );
  }

  const visibleInbound = inbound.slice(0, 6);
  const inboundOverflow = inbound.length - visibleInbound.length;

  const visibleOutbound = outbound.slice(0, 6);
  const outboundOverflow = outbound.length - visibleOutbound.length;

  const centerLastSegment = conceptId.split("/").pop() ?? conceptId;
  const centerDisplay =
    centerLastSegment.length > TRUNCATE_LEN ? `${centerLastSegment.slice(0, TRUNCATE_LEN - 1)}…` : centerLastSegment;

  const getInboundY = (index: number, count: number): number => {
    if (count === 1) {
      return 110;
    }
    return 24 + (index * (196 - 24)) / (count - 1);
  };

  const getOutboundY = (index: number, count: number): number => {
    if (count === 1) {
      return 110;
    }
    return 24 + (index * (196 - 24)) / (count - 1);
  };

  return (
    <div className={clsx("rounded-xl border border-border bg-surface-2/30 p-2.5", className)}>
      <div className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-muted">Connections</div>
      <svg
        viewBox="0 0 280 220"
        className="w-full h-auto overflow-visible select-none text-[11px]"
        aria-label="Connections graph"
      >
        <defs>
          <linearGradient id="okf-grad-inbound" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#22d3ee" />
            <stop offset="100%" stopColor="#8b5cf6" />
          </linearGradient>
          <linearGradient id="okf-grad-outbound" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#8b5cf6" />
            <stop offset="100%" stopColor="#22d3ee" />
          </linearGradient>

          <marker id="okf-arrow-in" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="5" markerHeight="5" orient="auto">
            <path
              d="M 0 1 L 6 4 L 0 7"
              fill="none"
              stroke="#8b5cf6"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </marker>
          <marker id="okf-arrow-out" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="5" markerHeight="5" orient="auto">
            <path
              d="M 0 1 L 6 4 L 0 7"
              fill="none"
              stroke="#22d3ee"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </marker>
        </defs>

        {/* Inbound Edges */}
        {visibleInbound.map((_, i) => {
          const y = getInboundY(i, visibleInbound.length);
          const d = `M 70 ${y} C 85 ${y}, 85 110, 100 110`;
          return (
            <motion.path
              key={`edge-in-${visibleInbound[i]}`}
              d={d}
              fill="none"
              stroke="url(#okf-grad-inbound)"
              strokeWidth="1.5"
              markerEnd="url(#okf-arrow-in)"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.4, delay: i * 0.04, ease: "easeOut" }}
            />
          );
        })}

        {/* Outbound Edges */}
        {visibleOutbound.map((item, i) => {
          const y = getOutboundY(i, visibleOutbound.length);
          const d = `M 180 110 C 195 110, 195 ${y}, 210 ${y}`;
          return (
            <motion.path
              key={`edge-out-${item.id}`}
              d={d}
              fill="none"
              stroke="url(#okf-grad-outbound)"
              strokeWidth="1.5"
              markerEnd="url(#okf-arrow-out)"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{
                duration: 0.4,
                delay: (visibleInbound.length + i) * 0.04,
                ease: "easeOut",
              }}
            />
          );
        })}

        {/* Center Node */}
        <g className="cursor-default">
          <rect x="100" y="98" width="80" height="24" rx="6" className="fill-surface stroke-accent-500/50 stroke-1.5" />
          <text x="140" y="110" textAnchor="middle" dominantBaseline="central" className="fill-fg font-medium">
            {centerDisplay}
          </text>
          <title>{conceptId}</title>
        </g>

        {/* Inbound Nodes (Left column, x=36, pill width 68 -> x: 2 to 70) */}
        {visibleInbound.map((id, i) => {
          const y = getInboundY(i, visibleInbound.length);
          const lastSeg = id.split("/").pop() ?? id;
          const display = lastSeg.length > TRUNCATE_LEN ? `${lastSeg.slice(0, TRUNCATE_LEN - 1)}…` : lastSeg;
          return (
            // biome-ignore lint/a11y/noStaticElementInteractions: SVG interactive graph node
            <g key={`in-${id}`} className="cursor-pointer" onClick={() => navigate(conceptUrl(project, id))}>
              <rect
                x="2"
                y={y - 10}
                width="68"
                height="20"
                rx="5"
                className="fill-surface stroke-border hover:stroke-accent-500 hover:fill-surface-2 transition-colors stroke-1"
              />
              <text
                x="36"
                y={y}
                textAnchor="middle"
                dominantBaseline="central"
                className="fill-muted hover:fill-fg text-[10px] pointer-events-none"
              >
                {display}
              </text>
              <title>{id}</title>
            </g>
          );
        })}

        {inboundOverflow > 0 && (
          <text x="36" y="212" textAnchor="middle" className="fill-subtle text-[10px] font-mono">
            +{inboundOverflow} more
          </text>
        )}

        {/* Outbound Nodes (Right column, x=244, pill width 68 -> x: 210 to 278) */}
        {visibleOutbound.map((item, i) => {
          const y = getOutboundY(i, visibleOutbound.length);
          const lastSeg = item.id.split("/").pop() ?? item.id;
          const display = lastSeg.length > TRUNCATE_LEN ? `${lastSeg.slice(0, TRUNCATE_LEN - 1)}…` : lastSeg;
          const isClickable = item.exists !== false;

          return (
            // biome-ignore lint/a11y/noStaticElementInteractions: SVG interactive graph node
            <g
              key={`out-${item.id}`}
              className={isClickable ? "cursor-pointer" : "cursor-not-allowed"}
              onClick={() => {
                if (isClickable) {
                  navigate(conceptUrl(project, item.id));
                }
              }}
            >
              <rect
                x="210"
                y={y - 10}
                width="68"
                height="20"
                rx="5"
                strokeDasharray={item.exists === false ? "3 2" : undefined}
                className={
                  item.exists === false
                    ? "fill-surface stroke-rose-500/80 stroke-1"
                    : "fill-surface stroke-border hover:stroke-accent-500 hover:fill-surface-2 transition-colors stroke-1"
                }
              />
              <text
                x="244"
                y={y}
                textAnchor="middle"
                dominantBaseline="central"
                className={
                  item.exists === false
                    ? "fill-rose-500 text-[10px] pointer-events-none"
                    : "fill-muted hover:fill-fg text-[10px] pointer-events-none"
                }
              >
                {display}
              </text>
              <title>
                {item.id}
                {item.exists === false ? " (missing)" : ""}
              </title>
            </g>
          );
        })}

        {outboundOverflow > 0 && (
          <text x="244" y="212" textAnchor="middle" className="fill-subtle text-[10px] font-mono">
            +{outboundOverflow} more
          </text>
        )}
      </svg>
    </div>
  );
}
