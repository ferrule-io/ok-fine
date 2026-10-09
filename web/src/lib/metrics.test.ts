import { describe, expect, it } from "vitest";
import type { MetricsPoint, MetricsReport } from "../../../src/metrics/types.js";
import { seriesValues } from "./metrics.js";

const point = (at: string, layer: MetricsPoint["layer"], count: number): MetricsPoint => ({
  at,
  layer,
  count,
  serverErrors: 0,
  avgMs: 1,
  p95Ms: 1,
});

describe("seriesValues", () => {
  it("fills every step of the window with the layer's points and nulls elsewhere", () => {
    const report: MetricsReport = {
      window: "1h",
      from: "2026-10-09T11:00:00.000Z",
      to: "2026-10-09T12:00:30.000Z",
      stepSeconds: 60,
      layers: [],
      operations: [],
      series: [point("2026-10-09T11:05:00.000Z", "service", 7), point("2026-10-09T11:06:00.000Z", "storage", 9)],
    };
    const values = seriesValues(report, "service", (p) => p.count);
    expect(values).toHaveLength(61);
    expect(values[0]?.at).toBe("2026-10-09T11:00:00.000Z");
    expect(values[60]?.at).toBe("2026-10-09T12:00:00.000Z");
    expect(values[5]?.value).toBe(7);
    expect(values.filter((v) => v.value !== null)).toHaveLength(1);
  });
});
