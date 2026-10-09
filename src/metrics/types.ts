// Wire types of GET /api/v1/metrics. No imports: the web UI imports this module.

export const METRICS_LAYERS = ["service", "storage"] as const;
export type MetricsLayer = (typeof METRICS_LAYERS)[number];

export const METRICS_WINDOWS = ["1h", "24h", "7d", "30d"] as const;
export type MetricsWindow = (typeof METRICS_WINDOWS)[number];

export interface MetricsStats {
  count: number;
  clientErrors: number;
  serverErrors: number;
  avgMs: number;
  maxMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
}

export interface LayerMetrics extends MetricsStats {
  layer: MetricsLayer;
}

export interface OperationMetrics extends MetricsStats {
  layer: MetricsLayer;
  op: string;
}

export interface MetricsPoint {
  at: string;
  layer: MetricsLayer;
  count: number;
  serverErrors: number;
  avgMs: number;
  p95Ms: number;
}

export interface MetricsReport {
  window: MetricsWindow;
  /** ISO; window start aligned down to stepSeconds. */
  from: string;
  /** ISO; now (second precision). */
  to: string;
  stepSeconds: number;
  /** Layers with data, service first. */
  layers: LayerMetrics[];
  /** Service first, then count desc, then op asc. */
  operations: OperationMetrics[];
  /** Non-empty steps only, ascending `at`, service before storage. */
  series: MetricsPoint[];
}
