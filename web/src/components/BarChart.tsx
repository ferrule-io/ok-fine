import { clsx } from "clsx";
import { absoluteTime } from "../lib/format.js";

export interface BarChartProps {
  title: string;
  values: Array<{ at: string; value: number | null }>;
  format: (v: number) => string;
  className?: string;
}

const WIDTH = 600;
const HEIGHT = 140;
const PLOT_HEIGHT = 130;

export function BarChart({ title, values, format, className }: BarChartProps) {
  const max = values.reduce((m, v) => Math.max(m, v.value ?? 0), 0);
  const slot = values.length > 0 ? WIDTH / values.length : WIDTH;
  const first = values[0];
  const last = values[values.length - 1];

  return (
    <div className={clsx("rounded-xl border border-border bg-surface p-4", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wider text-muted">{title}</span>
        {max > 0 && <span className="text-[11px] font-mono text-subtle">max {format(max)}</span>}
      </div>
      {max > 0 ? (
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={title}
          className="mt-3 h-36 w-full"
        >
          {values.map((v, i) => {
            if (!v.value) return null;
            const h = Math.max((v.value / max) * PLOT_HEIGHT, 1);
            return (
              <rect
                key={v.at}
                x={i * slot}
                y={HEIGHT - h}
                width={Math.max(slot - 1, 0.5)}
                height={h}
                className="fill-accent-500/70 hover:fill-accent-500"
              >
                <title>
                  {absoluteTime(v.at)} · {format(v.value)}
                </title>
              </rect>
            );
          })}
          <line x1={0} x2={WIDTH} y1={HEIGHT - 0.5} y2={HEIGHT - 0.5} className="stroke-border" />
        </svg>
      ) : (
        <div className="mt-3 flex h-36 items-center justify-center text-xs text-subtle">No data</div>
      )}
      {first && last && (
        <div className="mt-1 flex justify-between text-[10px] text-subtle">
          <span>{absoluteTime(first.at)}</span>
          <span>{absoluteTime(last.at)}</span>
        </div>
      )}
    </div>
  );
}
