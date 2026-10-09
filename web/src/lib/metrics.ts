import type { MetricsLayer, MetricsPoint, MetricsReport } from "../../../src/metrics/types.js";

/** One entry per step from `from` through `to` for `layer`; steps without calls are null. */
export function seriesValues(
  report: MetricsReport,
  layer: MetricsLayer,
  pick: (p: MetricsPoint) => number,
): Array<{ at: string; value: number | null }> {
  const byTime = new Map<number, MetricsPoint>();
  for (const p of report.series) {
    if (p.layer === layer) byTime.set(Date.parse(p.at), p);
  }
  const step = report.stepSeconds * 1000;
  const end = Date.parse(report.to);
  const values: Array<{ at: string; value: number | null }> = [];
  for (let t = Date.parse(report.from); t <= end; t += step) {
    const point = byTime.get(t);
    values.push({ at: new Date(t).toISOString(), value: point ? pick(point) : null });
  }
  return values;
}
