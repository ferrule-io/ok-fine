/** Trust tiers, lowest to highest trust. */
export const TRUST_TIERS = ["proposed", "unverified", "machine-confirmed", "human-reviewed"] as const;
export type TrustTier = (typeof TRUST_TIERS)[number];
export type Status = "draft" | "stable" | "deprecated";

export const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

export function normalizeVerified(v: unknown): Array<{ by: string; at?: string }> {
  if (v == null) {
    return [];
  }
  const rawList: unknown[] = Array.isArray(v) ? v : [v];
  const result: Array<{ by: string; at?: string }> = [];

  for (const item of rawList) {
    if (item && typeof item === "object" && "by" in item && typeof item.by === "string" && item.by.length > 0) {
      const at = "at" in item && typeof item.at === "string" ? item.at : undefined;
      result.push({ by: item.by, at });
    }
  }

  return result;
}

/** A concept recording unmerged work: its `proposal` key is set to anything but null/false. */
export function isProposal(fm: Record<string, unknown> | null | undefined): boolean {
  const p = fm?.proposal;
  return p !== undefined && p !== null && p !== false;
}

export function trustTier(fm: Record<string, unknown> | null | undefined): TrustTier {
  if (isProposal(fm)) {
    return "proposed";
  }
  const verified = normalizeVerified(fm?.verified);
  if (verified.length === 0) {
    return "unverified";
  }
  for (const entry of verified) {
    if (entry.by.startsWith("human:")) {
      return "human-reviewed";
    }
  }
  return "machine-confirmed";
}

export function effectiveStatus(fm: Record<string, unknown> | null | undefined): Status {
  const s = fm?.status;
  if (s === "draft" || s === "stable" || s === "deprecated") {
    return s;
  }
  return "stable";
}

export function staleAfter(fm: Record<string, unknown> | null | undefined): string | null {
  const raw = fm?.stale_after;
  if (typeof raw === "string") {
    const parsed = Date.parse(raw);
    if (!Number.isNaN(parsed)) {
      return raw;
    }
  }
  return null;
}

export function isStale(fm: Record<string, unknown> | null | undefined, now: Date): boolean {
  const sa = staleAfter(fm);
  if (!sa) {
    return false;
  }
  const time = Date.parse(sa);
  if (Number.isNaN(time)) {
    return false;
  }
  return now.getTime() >= time;
}

export function generatedAt(fm: Record<string, unknown> | null | undefined): string | null {
  if (
    fm?.generated &&
    typeof fm.generated === "object" &&
    "at" in fm.generated &&
    typeof fm.generated.at === "string"
  ) {
    return fm.generated.at;
  }
  const legacy = fm?.timestamp;
  if (typeof legacy === "string") {
    return legacy;
  }
  if (legacy instanceof Date) {
    return legacy.toISOString().replace(/\.\d{3}Z$/, "Z");
  }
  return null;
}

export function generatedBy(fm: Record<string, unknown> | null | undefined): string | null {
  if (
    fm?.generated &&
    typeof fm.generated === "object" &&
    "by" in fm.generated &&
    typeof fm.generated.by === "string"
  ) {
    return fm.generated.by;
  }
  return null;
}

export function lastVerifiedAt(fm: Record<string, unknown> | null | undefined): string | null {
  const verified = normalizeVerified(fm?.verified);
  let latest: { atStr: string; timestamp: number } | null = null;

  for (const entry of verified) {
    if (entry.at) {
      const parsed = Date.parse(entry.at);
      if (!Number.isNaN(parsed)) {
        if (!latest || parsed > latest.timestamp) {
          latest = { atStr: entry.at, timestamp: parsed };
        }
      }
    }
  }

  return latest?.atStr ?? null;
}

const HUMAN_ACTOR_RE = /^human:([A-Za-z0-9._@+-]+)$/;
const PROCESS_ACTOR_RE = /^process:([A-Za-z0-9._@+-]+)$/;
const AGENT_ACTOR_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._:+-]+$/;

export function parseActor(s: string): { kind: "human" | "process" | "agent"; id: string } | null {
  const humanMatch = HUMAN_ACTOR_RE.exec(s);
  if (humanMatch?.[1]) {
    return { kind: "human", id: humanMatch[1] };
  }
  const processMatch = PROCESS_ACTOR_RE.exec(s);
  if (processMatch?.[1]) {
    return { kind: "process", id: processMatch[1] };
  }
  if (AGENT_ACTOR_RE.test(s)) {
    return { kind: "agent", id: s };
  }
  return null;
}

export function displayTitle(fm: Record<string, unknown> | null | undefined, conceptId: string): string {
  if (typeof fm?.title === "string" && fm.title.length > 0) {
    return fm.title;
  }
  const segments = conceptId.split("/");
  const last = segments[segments.length - 1];
  return last && last.length > 0 ? last : conceptId;
}
