/**
 * Inclusive upper bounds (ms) of the latency histogram buckets; one overflow bucket follows the last.
 * Changing them changes the database columns: bump SCHEMA_VERSION in store.ts.
 */
export const LATENCY_BUCKETS_MS = [
  0.1, 0.25, 0.5, 1, 2.5, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000,
] as const;

export const BUCKET_COUNT = LATENCY_BUCKETS_MS.length + 1;

export function bucketIndex(ms: number): number {
  const i = LATENCY_BUCKETS_MS.findIndex((upper) => ms <= upper);
  return i === -1 ? BUCKET_COUNT - 1 : i;
}

/** Estimates quantile q (0..1) by linear interpolation inside the bucket holding the rank, clamped to [minMs, maxMs]. */
export function quantile(buckets: readonly number[], q: number, minMs: number, maxMs: number): number {
  let total = 0;
  for (const c of buckets) total += c;
  if (total === 0) return 0;
  const rank = q * total;
  let cum = 0;
  for (let i = 0; i < buckets.length; i++) {
    const c = buckets[i] ?? 0;
    if (c === 0) continue;
    if (cum + c >= rank) {
      const lower = i === 0 ? 0 : (LATENCY_BUCKETS_MS[i - 1] ?? 0);
      const upper = i < LATENCY_BUCKETS_MS.length ? (LATENCY_BUCKETS_MS[i] ?? maxMs) : maxMs;
      const value = lower + (upper - lower) * ((rank - cum) / c);
      return Math.min(Math.max(value, minMs), maxMs);
    }
    cum += c;
  }
  return maxMs;
}
