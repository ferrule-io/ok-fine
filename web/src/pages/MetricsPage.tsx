import { clsx } from "clsx";
import { Activity, AlertTriangle, Database, Gauge, Timer } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router";
import type { MetricsLayer, MetricsWindow, OperationMetrics } from "../../../src/metrics/types.js";
import { useMetrics } from "../api/queries.js";
import { BarChart } from "../components/BarChart.js";
import { EmptyState } from "../components/EmptyState.js";
import { ErrorState } from "../components/ErrorState.js";
import { Page } from "../components/Page.js";
import { Skeleton } from "../components/Skeleton.js";
import { StatCard } from "../components/StatCard.js";
import { formatCount, formatMs, relativeTime } from "../lib/format.js";
import { seriesValues } from "../lib/metrics.js";

// Web runtime code imports only types from src/, so the window list is restated here.
const RANGES = ["1h", "24h", "7d", "30d"] as const satisfies readonly MetricsWindow[];
const LAYER_OPTIONS = ["service", "storage"] as const satisfies readonly MetricsLayer[];
const LAYER_LABELS: Record<MetricsLayer, string> = { service: "Service", storage: "Storage" };
const PAGE_CLASS = "mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8";

function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  labelOf,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  labelOf?: (v: T) => string;
}) {
  return (
    <fieldset aria-label={label} className="inline-flex rounded-lg border border-border bg-surface p-0.5">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          aria-pressed={o === value}
          onClick={() => onChange(o)}
          className={clsx(
            "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
            o === value ? "bg-surface-2 text-fg" : "text-muted hover:text-fg",
          )}
        >
          {labelOf ? labelOf(o) : o}
        </button>
      ))}
    </fieldset>
  );
}

const NUM = "px-3 py-2 text-right font-mono tabular-nums";

function OperationsTable({ title, subtitle, rows }: { title: string; subtitle: string; rows: OperationMetrics[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-fg">{title}</h2>
        <p className="mt-1 text-sm text-muted">{subtitle}</p>
      </div>
      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted">
              <th className="px-3 py-2 text-left font-medium">Operation</th>
              {["Calls", "Client err.", "Server err.", "Avg", "p50", "p95", "p99", "Max"].map((h) => (
                <th key={h} className="px-3 py-2 text-right font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.op}>
                <td className="px-3 py-2 font-mono text-fg">{r.op}</td>
                <td className={NUM}>{formatCount(r.count)}</td>
                <td className={NUM}>{formatCount(r.clientErrors)}</td>
                <td className={clsx(NUM, r.serverErrors > 0 && "text-rose-600 dark:text-rose-400")}>
                  {formatCount(r.serverErrors)}
                </td>
                <td className={NUM}>{formatMs(r.avgMs)}</td>
                <td className={NUM}>{formatMs(r.p50Ms)}</td>
                <td className={NUM}>{formatMs(r.p95Ms)}</td>
                <td className={NUM}>{formatMs(r.p99Ms)}</td>
                <td className={NUM}>{formatMs(r.maxMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function MetricsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const param = searchParams.get("window");
  const range = RANGES.find((r) => r === param) ?? "24h";
  const [layer, setLayer] = useState<MetricsLayer>("service");
  const query = useMetrics(range);

  if (query.isLoading) {
    return (
      <Page title="Metrics" className={PAGE_CLASS}>
        <div className="space-y-2">
          <Skeleton className="h-8 w-48 rounded-lg" />
          <Skeleton className="h-4 w-96 rounded-md" />
        </div>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {RANGES.map((r) => (
            <Skeleton key={r} className="h-24 rounded-xl" />
          ))}
        </div>
        <Skeleton className="mt-8 h-48 w-full rounded-xl" />
      </Page>
    );
  }

  if (query.isError || !query.data) {
    return (
      <Page title="Metrics" className={PAGE_CLASS}>
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </Page>
    );
  }

  const report = query.data;
  const svc = report.layers.find((l) => l.layer === "service");
  const sto = report.layers.find((l) => l.layer === "storage");

  const header = (
    <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-fg">Metrics</h1>
        <p className="mt-1 text-sm text-muted">
          Latency and errors of service operations and storage calls, aggregated per minute.
        </p>
        <p className="mt-1 text-xs text-subtle">Updated {relativeTime(report.to)}</p>
      </div>
      <Segmented
        label="Time window"
        options={RANGES}
        value={range}
        onChange={(r) => setSearchParams({ window: r }, { replace: true })}
      />
    </div>
  );

  if (report.operations.length === 0) {
    return (
      <Page title="Metrics" className={PAGE_CLASS}>
        {header}
        <EmptyState
          icon={Gauge}
          title="No calls recorded in this window"
          hint="ok-fine aggregates call timings per minute in DATA_DIR/metrics.sqlite."
        />
      </Page>
    );
  }

  return (
    <Page title="Metrics" className={PAGE_CLASS}>
      {header}
      <div className="space-y-10">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Service calls" icon={Activity} value={svc ? formatCount(svc.count) : "—"} />
          <StatCard label="Service p95" icon={Timer} value={svc ? formatMs(svc.p95Ms) : "—"}>
            {svc && (
              <span className="text-xs text-muted">
                p50 {formatMs(svc.p50Ms)} · p99 {formatMs(svc.p99Ms)}
              </span>
            )}
          </StatCard>
          <StatCard
            label="Server errors"
            icon={AlertTriangle}
            value={svc ? formatCount(svc.serverErrors) : "—"}
            tone={svc && svc.serverErrors > 0 ? "warn" : "default"}
          >
            {svc && (
              <span className="text-xs text-muted">
                {((svc.serverErrors / svc.count) * 100).toFixed(1)}% of service calls · {formatCount(svc.clientErrors)}{" "}
                client errors
              </span>
            )}
          </StatCard>
          <StatCard label="Storage p95" icon={Database} value={sto ? formatMs(sto.p95Ms) : "—"}>
            {sto && <span className="text-xs text-muted">{formatCount(sto.count)} calls</span>}
          </StatCard>
        </div>

        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h2 className="text-lg font-semibold tracking-tight text-fg">Over time</h2>
            <Segmented
              label="Layer"
              options={LAYER_OPTIONS}
              value={layer}
              onChange={setLayer}
              labelOf={(l) => LAYER_LABELS[l]}
            />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <BarChart title="Calls" values={seriesValues(report, layer, (p) => p.count)} format={formatCount} />
            <BarChart title="p95 latency" values={seriesValues(report, layer, (p) => p.p95Ms)} format={formatMs} />
          </div>
        </section>

        <OperationsTable
          title="Service operations"
          subtitle="One row per KnowledgeService method, shared by MCP tools and REST routes."
          rows={report.operations.filter((o) => o.layer === "service")}
        />
        <OperationsTable
          title="Storage calls"
          subtitle="StorageBackend and transaction calls; transaction includes lock wait, commit, and push."
          rows={report.operations.filter((o) => o.layer === "storage")}
        />
      </div>
    </Page>
  );
}
