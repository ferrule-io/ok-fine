/**
 * Normalize a git remote URL to `host/path` (lowercase, no scheme, userinfo, port, or `.git`), so the same
 * repository compares equal across `git@host:org/repo.git`, `https://host/org/repo`, and `ssh://git@host:22/org/repo`.
 * Returns null for local paths and anything that is not a recognizable remote.
 */
export function normalizeRepository(raw: string): string | null {
  const input = raw.trim();
  if (input === "") return null;

  let host: string;
  let path: string;

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) {
    let url: URL;
    try {
      url = new URL(input);
    } catch {
      return null;
    }
    if (url.protocol === "file:") return null;
    host = url.hostname;
    path = url.pathname;
  } else {
    const scp = /^[^\s/@]+@([^\s/:]+):(.+)$/.exec(input);
    if (scp) {
      host = scp[1] ?? "";
      path = scp[2] ?? "";
    } else {
      if (/^[/.~]/.test(input) || input.includes("\\")) return null;
      const slash = input.indexOf("/");
      if (slash < 0) return null;
      host = input.slice(0, slash);
      path = input.slice(slash + 1);
      if (!host.includes(".") && host.toLowerCase() !== "localhost") return null;
    }
  }

  host = host.toLowerCase();
  path = path
    .toLowerCase()
    .replace(/\/{2,}/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");

  const result = `${host}/${path}`;
  return /^[a-z0-9][a-z0-9.-]*(\/[^/\s]+)+$/.test(result) ? result : null;
}
