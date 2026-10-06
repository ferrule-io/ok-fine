import { isDeepStrictEqual } from "node:util";
import { Document, isMap, parseDocument } from "yaml";

export function splitFrontmatter(text: string): { yaml: string; body: string } | null {
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }
  const match = /^---\r?\n/.exec(text);
  if (!match) {
    return null;
  }
  const yamlStart = match[0].length;
  const closingRegex = /\r?\n---\r?\n|\r?\n---$/g;
  closingRegex.lastIndex = yamlStart;
  const closeMatch = closingRegex.exec(text);
  if (!closeMatch) {
    return null;
  }
  const yamlEnd = closeMatch.index;
  const bodyStart = closeMatch.index + closeMatch[0].length;
  const yaml = text.slice(yamlStart, yamlEnd);
  let body = text.slice(bodyStart);
  body = body.replace(/^(\r?\n)+/, "");
  return { yaml, body };
}

export function parseFrontmatter(
  yaml: string,
):
  | { doc: Document; data: Record<string, unknown> }
  | { error: "invalid_yaml" | "frontmatter_not_mapping"; message: string } {
  const doc = parseDocument(yaml);
  if (doc.errors.length > 0) {
    return {
      error: "invalid_yaml",
      message: doc.errors.map((e) => e.message).join("; "),
    };
  }
  if (!doc.contents || !isMap(doc.contents)) {
    return {
      error: "frontmatter_not_mapping",
      message: "frontmatter must be a YAML mapping",
    };
  }
  const data = (doc.toJS() ?? {}) as Record<string, unknown>;
  return { doc, data };
}

export function serializeConcept(doc: Document, body: string): string {
  const normalizedBody = body.replace(/\r\n/g, "\n").replace(/^\n+/, "").replace(/\s*$/, "");
  return `---\n${doc.toString({ lineWidth: 0 })}---\n\n${normalizedBody}\n`;
}

function createFormattedNode(doc: Document, key: string, val: unknown): unknown {
  if (key === "tags" && Array.isArray(val)) {
    return doc.createNode(val, { flow: true });
  }
  if (key === "usage_window" && val && typeof val === "object" && !Array.isArray(val)) {
    return doc.createNode(val, { flow: true });
  }
  if (key === "parameters" && Array.isArray(val)) {
    return doc.createNode(
      val.map((item) =>
        item && typeof item === "object" && !Array.isArray(item) ? doc.createNode(item, { flow: true }) : item,
      ),
    );
  }
  if (key === "generated" && val && typeof val === "object") {
    return doc.createNode(val, { flow: true });
  }
  return val;
}

export function applyFrontmatter(
  existing: Document | null,
  input: Record<string, unknown>,
  server: { generated: { by: string; at: string } },
): { doc: Document; ignoredKeys: string[] } {
  const ignoredKeys: string[] = [];

  if (existing !== null) {
    const existingJs = (existing.toJS() ?? {}) as Record<string, unknown>;
    if ("generated" in input && !isDeepStrictEqual(input.generated, existingJs.generated)) {
      ignoredKeys.push("generated");
    }
    if ("verified" in input && !isDeepStrictEqual(input.verified, existingJs.verified)) {
      ignoredKeys.push("verified");
    }

    const cleanInput: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input)) {
      if (k !== "generated" && k !== "verified") {
        cleanInput[k] = v;
      }
    }

    const keysToDelete: string[] = [];
    if (isMap(existing.contents)) {
      for (const item of existing.contents.items) {
        if (!item || typeof item !== "object" || !("key" in item) || item.key == null) {
          continue;
        }
        let keyName = "";
        const rawKey = item.key;
        if (typeof rawKey === "string") {
          keyName = rawKey;
        } else if (typeof rawKey === "object" && "value" in rawKey && typeof rawKey.value === "string") {
          keyName = rawKey.value;
        } else {
          keyName = String(rawKey);
        }
        if (keyName && keyName !== "generated" && keyName !== "verified" && !(keyName in cleanInput)) {
          keysToDelete.push(keyName);
        }
      }
    }
    for (const k of keysToDelete) {
      existing.delete(k);
    }

    for (const [k, v] of Object.entries(cleanInput)) {
      if (existing.has(k)) {
        if (!isDeepStrictEqual(existingJs[k], v)) {
          existing.set(k, createFormattedNode(existing, k, v));
        }
      } else {
        existing.set(k, createFormattedNode(existing, k, v));
      }
    }

    existing.set("generated", existing.createNode(server.generated, { flow: true }));
    return { doc: existing, ignoredKeys };
  } else {
    if ("generated" in input) {
      ignoredKeys.push("generated");
    }
    if ("verified" in input) {
      ignoredKeys.push("verified");
    }

    const cleanInput: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input)) {
      if (k !== "generated" && k !== "verified") {
        cleanInput[k] = v;
      }
    }

    const doc = new Document();
    const firstKeys = ["type", "title", "description", "resource", "tags", "status"];
    const endKeys = ["stale_after", "sources", "usage_window"];

    for (const k of firstKeys) {
      if (k in cleanInput) {
        doc.set(k, createFormattedNode(doc, k, cleanInput[k]));
      }
    }
    for (const [k, v] of Object.entries(cleanInput)) {
      if (!firstKeys.includes(k) && !endKeys.includes(k)) {
        doc.set(k, createFormattedNode(doc, k, v));
      }
    }
    doc.set("generated", doc.createNode(server.generated, { flow: true }));
    for (const k of endKeys) {
      if (k in cleanInput) {
        doc.set(k, createFormattedNode(doc, k, cleanInput[k]));
      }
    }

    return { doc, ignoredKeys };
  }
}

export function appendVerification(doc: Document, entry: { by: string; at: string }): void {
  const js = (doc.toJS() ?? {}) as Record<string, unknown>;
  const raw = js.verified;
  let list: Array<{ by: string; at?: string }> = [];
  if (raw && typeof raw === "object") {
    if (Array.isArray(raw)) {
      list = raw.filter((item): item is { by: string; at?: string } =>
        Boolean(item && typeof item === "object" && typeof item.by === "string" && item.by.length > 0),
      );
    } else {
      if ("by" in raw && typeof raw.by === "string" && raw.by.length > 0) {
        const atVal = "at" in raw && typeof raw.at === "string" ? raw.at : undefined;
        list = [{ by: raw.by, at: atVal }];
      }
    }
  }
  list.push(entry);
  if (list.length === 1) {
    doc.set("verified", doc.createNode(list[0], { flow: true }));
  } else {
    doc.set("verified", doc.createNode(list.map((e) => doc.createNode(e, { flow: true }))));
  }
}

export function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function isoAfterDays(now: Date, days: number): string {
  const d = new Date(now.getTime() + days * 86_400_000);
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}
