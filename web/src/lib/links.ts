const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

export type ResolvedHref =
  | { kind: "concept"; id: string; hash: string }
  | { kind: "file"; path: string; hash: string }
  | { kind: "anchor"; hash: string }
  | { kind: "external"; href: string }
  | { kind: "invalid" };

function posixNormalize(path: string): string {
  if (path.length === 0) return ".";
  const isAbsolute = path.charCodeAt(0) === 47;
  const trailingSlash = path.charCodeAt(path.length - 1) === 47;
  const segments = path.split("/");
  const res: string[] = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      if (res.length > 0 && res[res.length - 1] !== "..") {
        res.pop();
      } else if (!isAbsolute) {
        res.push("..");
      }
    } else {
      res.push(seg);
    }
  }

  let result = res.join("/");
  if (isAbsolute) {
    result = `/${result}`;
  }
  if (result.length === 0) {
    return isAbsolute ? "/" : ".";
  }
  if (trailingSlash && !result.endsWith("/")) {
    result += "/";
  }
  return result;
}

function posixDirname(path: string): string {
  if (path.length === 0) return ".";
  const hasRoot = path.charCodeAt(0) === 47;
  let end = -1;
  let matchedSlash = true;
  for (let i = path.length - 1; i >= 1; --i) {
    if (path.charCodeAt(i) === 47) {
      if (!matchedSlash) {
        end = i;
        break;
      }
    } else {
      matchedSlash = false;
    }
  }
  if (end === -1) return hasRoot ? "/" : ".";
  return path.slice(0, end);
}

function posixBasename(path: string): string {
  if (path.length === 0) return "";
  let start = 0;
  let end = -1;
  let matchedSlash = true;
  for (let i = path.length - 1; i >= 0; --i) {
    if (path.charCodeAt(i) === 47) {
      if (!matchedSlash) {
        start = i + 1;
        break;
      }
    } else if (end === -1) {
      matchedSlash = false;
      end = i + 1;
    }
  }
  if (end === -1) return "";
  return path.slice(start, end);
}

export function resolveHref(href: string, conceptId: string): ResolvedHref {
  if (!href) {
    return { kind: "invalid" };
  }
  if (href.startsWith("#")) {
    return { kind: "anchor", hash: href };
  }
  if (href.startsWith("//") || SCHEME_RE.test(href)) {
    return { kind: "external", href };
  }

  let decoded = href;
  try {
    decoded = decodeURI(href);
  } catch {
    // Keep raw href on malformed URI sequences
  }

  let hash = "";
  const hashIdx = decoded.indexOf("#");
  if (hashIdx !== -1) {
    hash = decoded.slice(hashIdx);
    decoded = decoded.slice(0, hashIdx);
  }

  const queryIdx = decoded.indexOf("?");
  if (queryIdx !== -1) {
    decoded = decoded.slice(0, queryIdx);
  }

  let resolved: string;
  if (decoded.startsWith("/")) {
    resolved = posixNormalize(decoded.slice(1));
  } else {
    const dir = posixDirname(conceptId);
    const prefix = dir === "." ? "" : dir;
    resolved = posixNormalize(prefix ? `${prefix}/${decoded}` : decoded);
  }

  if (resolved === ".." || resolved.startsWith("../") || decoded.endsWith("/")) {
    return { kind: "invalid" };
  }

  if (resolved.endsWith(".md")) {
    const base = posixBasename(resolved);
    if (base === "index.md" || base === "log.md") {
      return { kind: "invalid" };
    }
    return { kind: "concept", id: resolved.slice(0, -3), hash };
  }

  return { kind: "file", path: resolved, hash };
}

export function conceptUrl(project: string, id: string): string {
  const cleanId = id.startsWith("/") ? id.slice(1) : id;
  return `/p/${encodeURIComponent(project)}/c/${cleanId}`;
}

export function fileUrl(project: string, path: string): string {
  const cleanPath = path.startsWith("/") ? path.slice(1) : path;
  return `/p/${encodeURIComponent(project)}/f/${cleanPath}`;
}
