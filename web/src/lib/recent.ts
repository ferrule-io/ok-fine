export interface RecentConcept {
  project: string;
  id: string;
  title: string;
  type: string | null;
}

const STORAGE_KEY = "okf.recent";
const MAX_RECENT = 8;

function isValidRecentConcept(item: unknown): item is RecentConcept {
  return Boolean(
    item &&
      typeof item === "object" &&
      "project" in item &&
      typeof item.project === "string" &&
      "id" in item &&
      typeof item.id === "string" &&
      "title" in item &&
      typeof item.title === "string" &&
      "type" in item &&
      (item.type === null || typeof item.type === "string"),
  );
}

export function getRecent(): RecentConcept[] {
  try {
    if (typeof localStorage === "undefined") {
      return [];
    }
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isValidRecentConcept).slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

export function addRecent(entry: RecentConcept): void {
  try {
    if (typeof localStorage === "undefined") {
      return;
    }
    const current = getRecent();
    const filtered = current.filter((item) => !(item.project === entry.project && item.id === entry.id));
    const updated = [entry, ...filtered].slice(0, MAX_RECENT);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // Ignore storage quota or access errors
  }
}
