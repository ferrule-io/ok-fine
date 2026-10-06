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

    if ("email" in parsed && typeof parsed.email === "string" && parsed.email.trim().length > 0) {
      return parsed.email.trim();
    }
    if (
      "preferred_username" in parsed &&
      typeof parsed.preferred_username === "string" &&
      parsed.preferred_username.trim().length > 0
    ) {
      return parsed.preferred_username.trim();
    }
    if ("name" in parsed && typeof parsed.name === "string" && parsed.name.trim().length > 0) {
      return parsed.name.trim();
    }
    if ("sub" in parsed && typeof parsed.sub === "string" && parsed.sub.trim().length > 0) {
      return parsed.sub.trim();
    }
    return null;
  } catch {
    return null;
  }
}
