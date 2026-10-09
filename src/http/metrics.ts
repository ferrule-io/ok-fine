import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { MetricsStore } from "../metrics/store.js";
import { METRICS_WINDOWS } from "../metrics/types.js";

const metricsQuery = z.object({ window: z.enum(METRICS_WINDOWS).default("24h") });

/** Reads MetricsStore directly: metrics are not knowledge, and the service stays free of database access. */
export function registerMetricsRoutes(app: FastifyInstance, metrics: MetricsStore): void {
  app.get("/api/v1/metrics", { config: { permission: "read" } as const }, async (req) => {
    const { window } = metricsQuery.parse(req.query);
    return metrics.report(window);
  });
}
