import { createHash } from "node:crypto";
import { posix } from "node:path";
import { OkfError } from "../errors.js";

export const PROJECT_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
export const SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function normalizeConceptIdForWrite(raw: string): string {
  let s = raw;
  if (s.startsWith("/")) {
    s = s.slice(1);
  }
  if (s.endsWith(".md")) {
    s = s.slice(0, -3);
  }
  if (s.length === 0) {
    throw new OkfError("invalid_id", 400, "concept ID cannot be empty");
  }
  if (s.length > 512) {
    throw new OkfError("invalid_id", 400, "concept ID cannot exceed 512 characters");
  }

  const segments = s.split("/");
  if (segments.length > 12) {
    throw new OkfError("invalid_id", 400, "concept ID cannot exceed 12 path segments");
  }

  for (const seg of segments) {
    if (!SEGMENT_RE.test(seg)) {
      throw new OkfError("invalid_id", 400, `invalid path segment "${seg}" in concept ID`);
    }
  }

  const lastSeg = segments[segments.length - 1];
  if (!lastSeg) {
    throw new OkfError("invalid_id", 400, "concept ID cannot have empty trailing segment");
  }
  const lastLower = lastSeg.toLowerCase();
  if (lastLower === "index" || lastLower === "log") {
    throw new OkfError("invalid_id", 400, `last segment of concept ID cannot be "${lastLower}"`);
  }

  return segments.join("/");
}

export function normalizeFilePathForWrite(raw: string): string {
  if (raw.toLowerCase().endsWith(".md")) {
    throw new OkfError(
      "use_write_concept",
      400,
      "markdown files are concepts; use write_concept"
    );
  }

  let s = raw;
  if (s.startsWith("/")) {
    s = s.slice(1);
  }
  if (s.length === 0) {
    throw new OkfError("invalid_path", 400, "file path cannot be empty");
  }
  if (s.length > 512) {
    throw new OkfError("invalid_path", 400, "file path cannot exceed 512 characters");
  }

  const segments = s.split("/");
  if (segments.length > 12) {
    throw new OkfError("invalid_path", 400, "file path cannot exceed 12 path segments");
  }

  for (const seg of segments) {
    if (!SEGMENT_RE.test(seg)) {
      throw new OkfError("invalid_path", 400, `invalid path segment "${seg}" in file path`);
    }
  }

  return segments.join("/");
}

export function resolveReadPath(raw: string): string {
  if (raw.includes("\\")) {
    throw new OkfError("invalid_path", 400, "path cannot contain backslashes");
  }
  let s = raw;
  if (s.startsWith("/")) {
    s = s.slice(1);
  }
  const rawSegments = s.split("/");
  for (const seg of rawSegments) {
    if (seg === ".." || seg.startsWith(".")) {
      throw new OkfError("invalid_path", 400, "path cannot traverse or contain dot segments");
    }
  }
  const normalized = posix.normalize(s);
  if (!normalized || normalized === "." || normalized === "") {
    throw new OkfError("invalid_path", 400, "path cannot be empty");
  }
  const segments = normalized.split("/");
  for (const seg of segments) {
    if (seg === ".." || seg.startsWith(".")) {
      throw new OkfError("invalid_path", 400, "path cannot traverse or contain dot segments");
    }
  }

  return normalized;
}

export function isReservedName(basename: string): boolean {
  return basename === "index.md" || basename === "log.md";
}

export function blobRevision(buf: Buffer): string {
  return createHash("sha1")
    .update(Buffer.from(`blob ${buf.length}\0`))
    .update(buf)
    .digest("hex");
}
