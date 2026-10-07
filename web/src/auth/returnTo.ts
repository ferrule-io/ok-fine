function hasControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}

/**
 * Sanitizes a candidate return-to URL to ensure it only redirects to a safe,
 * same-origin path within the ok-fine web UI (under `/ui/`).
 *
 * Rejects protocol-relative URLs (`//evil`), backslash variations (`/\evil`, `/\\evil`),
 * external schemes (`javascript:`, `https:`), URL-encoded slash/backslash variants,
 * non-UI server routes (`/api/`, `/healthz`, `/mcp`), and the OAuth `/callback` route.
 *
 * Returns a router-relative path starting with `/` (e.g. `/p/my-project`),
 * or fallback `"/"` if the input is unsafe or invalid.
 */
export function sanitizeReturnTo(raw: unknown, baseOrigin?: string): string {
  if (typeof raw !== "string" || hasControlChar(raw)) {
    return "/";
  }

  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.startsWith("//") || trimmed.includes("\\")) {
    return "/";
  }

  // Handle absolute http(s) URLs if matching origin
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    if (!/^https?:\/\//i.test(trimmed)) {
      return "/";
    }
    const origin = baseOrigin ?? (typeof window !== "undefined" ? window.location.origin : undefined);
    if (!origin) {
      return "/";
    }
    try {
      const parsed = new URL(trimmed);
      if (parsed.origin !== origin) {
        return "/";
      }
      return sanitizeReturnTo(`${parsed.pathname}${parsed.search}${parsed.hash}`, origin);
    } catch {
      return "/";
    }
  }

  // Reject URL-encoded slashes/backslashes (including multi-layer encoding) in the path
  const pathPart = trimmed.split(/[?#]/, 1)[0] ?? "";
  if (/%(?:2f|5c)/i.test(pathPart)) {
    return "/";
  }
  let decoded = pathPart;
  for (let i = 0; i < 3; i++) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
      if (decoded.includes("\\") || decoded.includes("//") || /%(?:2f|5c)/i.test(decoded)) {
        return "/";
      }
    } catch {
      return "/";
    }
  }

  // Must parse as relative path against internal dummy base
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(trimmed, "http://okf.internal");
    if (parsedUrl.origin !== "http://okf.internal") {
      return "/";
    }
  } catch {
    return "/";
  }

  let pathname = parsedUrl.pathname;
  if (pathname === "/ui" || pathname === "/ui/") {
    pathname = "/";
  } else if (pathname.startsWith("/ui/")) {
    pathname = pathname.slice(3); // keeps leading '/'
  } else if (/^\/(?:api|healthz|mcp|\.well-known)(?:\/|$)/.test(pathname)) {
    return "/";
  }

  // Never allow protocol-relative slashes or redirect back to callback (prevent auth loops)
  if (pathname.startsWith("//") || pathname === "/callback" || pathname.startsWith("/callback/")) {
    return "/";
  }

  return `${pathname}${parsedUrl.search}${parsedUrl.hash}`;
}

export function currentReturnTo(): string {
  if (typeof window === "undefined") {
    return "/";
  }

  // If a returnTo query parameter was provided (e.g. /ui/?returnTo=...), sanitize it
  try {
    const params = new URLSearchParams(window.location.search);
    const candidate = params.get("returnTo");
    if (candidate) {
      const sanitized = sanitizeReturnTo(candidate, window.location.origin);
      if (sanitized !== "/") {
        return sanitized;
      }
    }
  } catch {
    // ignore query search param parsing failure
  }

  const raw = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  return sanitizeReturnTo(raw, window.location.origin);
}
