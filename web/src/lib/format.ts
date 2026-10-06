const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

const dtf = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) {
    return iso;
  }

  const diffSec = Math.round((then - Date.now()) / 1000);
  const absSec = Math.abs(diffSec);

  if (absSec < 60) {
    return rtf.format(diffSec, "second");
  }

  const diffMin = Math.round(diffSec / 60);
  if (Math.abs(diffMin) < 60) {
    return rtf.format(diffMin, "minute");
  }

  const diffHours = Math.round(diffMin / 60);
  if (Math.abs(diffHours) < 24) {
    return rtf.format(diffHours, "hour");
  }

  const diffDays = Math.round(diffHours / 24);
  if (Math.abs(diffDays) < 7) {
    return rtf.format(diffDays, "day");
  }

  const diffWeeks = Math.round(diffDays / 7);
  if (Math.abs(diffWeeks) < 5) {
    return rtf.format(diffWeeks, "week");
  }

  const diffMonths = Math.round(diffDays / 30);
  if (Math.abs(diffMonths) < 12) {
    return rtf.format(diffMonths, "month");
  }

  const diffYears = Math.round(diffDays / 365);
  return rtf.format(diffYears, "year");
}

export function absoluteTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  return dtf.format(d);
}

export function hue(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = (hash * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 360;
}

export function initials(s: string): string {
  let cleaned = s.startsWith("human:") ? s.slice(6) : s;
  const atIndex = cleaned.indexOf("@");
  if (atIndex !== -1) {
    cleaned = cleaned.slice(0, atIndex);
  }

  const words = cleaned.match(/[A-Za-z0-9]+/g);
  if (!words || words.length === 0) {
    return "";
  }

  return words
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export function actorKind(actor: string): "human" | "agent" {
  return actor.startsWith("human:") ? "human" : "agent";
}

export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}
