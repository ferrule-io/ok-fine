function hasControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}

export function tokenIdentity(accessToken: string): string | null {
  try {
    const parts = accessToken.split(".");
    const rawPayload = parts[1];
    if (!rawPayload) return null;

    let b64 = rawPayload.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4 !== 0) {
      b64 += "=";
    }

    const binary = atob(b64);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const jsonStr = new TextDecoder().decode(bytes);
    const parsed: unknown = JSON.parse(jsonStr);

    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    const sanitizeClaim = (val: unknown): string | null => {
      if (typeof val !== "string") return null;
      const trimmed = val.trim();
      return trimmed.length > 0 && !hasControlChar(trimmed) ? trimmed : null;
    };

    if ("email" in parsed) {
      const email = sanitizeClaim(parsed.email);
      if (email) return email;
    }
    if ("preferred_username" in parsed) {
      const username = sanitizeClaim(parsed.preferred_username);
      if (username) return username;
    }
    if ("name" in parsed) {
      const name = sanitizeClaim(parsed.name);
      if (name) return name;
    }
    if ("sub" in parsed) {
      const sub = sanitizeClaim(parsed.sub);
      if (sub) return sub;
    }
    return null;
  } catch {
    return null;
  }
}
