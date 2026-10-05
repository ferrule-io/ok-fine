import { splitFrontmatter, parseFrontmatter } from "./frontmatter.js";
import {
  type Status,
  type TrustTier,
  displayTitle,
  effectiveStatus,
  trustTier,
  staleAfter,
  generatedAt,
  generatedBy,
  lastVerifiedAt,
} from "./semantics.js";
import { blobRevision } from "./paths.js";
import { extractLinks } from "./markdown.js";

export interface ConceptRecord {
  project: string;
  id: string;
  file: string;
  revision: string;
  frontmatter: Record<string, unknown> | null;
  body: string;
  parseError: string | null;
  title: string;
  description: string | null;
  type: string | null;
  tags: string[];
  status: Status;
  trustTier: TrustTier;
  staleAfter: string | null;
  generatedAt: string | null;
  generatedBy: string | null;
  lastVerifiedAt: string | null;
  outbound: string[];
}

export function parseConcept(project: string, id: string, file: string, buf: Buffer): ConceptRecord {
  const text = buf.toString("utf8");
  const revision = blobRevision(buf);

  const split = splitFrontmatter(text);
  if (!split) {
    return {
      project,
      id,
      file,
      revision,
      frontmatter: null,
      body: text,
      parseError: "missing_frontmatter",
      title: displayTitle(null, id),
      description: null,
      type: null,
      tags: [],
      status: "stable",
      trustTier: "unverified",
      staleAfter: null,
      generatedAt: null,
      generatedBy: null,
      lastVerifiedAt: null,
      outbound: [],
    };
  }

  const parsed = parseFrontmatter(split.yaml);
  if ("error" in parsed) {
    return {
      project,
      id,
      file,
      revision,
      frontmatter: null,
      body: split.body,
      parseError: parsed.error,
      title: displayTitle(null, id),
      description: null,
      type: null,
      tags: [],
      status: "stable",
      trustTier: "unverified",
      staleAfter: null,
      generatedAt: null,
      generatedBy: null,
      lastVerifiedAt: null,
      outbound: [],
    };
  }

  const { data } = parsed;
  if (typeof data.type !== "string" || data.type.trim().length === 0) {
    return {
      project,
      id,
      file,
      revision,
      frontmatter: null,
      body: split.body,
      parseError: "missing_type",
      title: displayTitle(data, id),
      description: typeof data.description === "string" ? data.description : null,
      type: null,
      tags: [],
      status: effectiveStatus(data),
      trustTier: trustTier(data),
      staleAfter: staleAfter(data),
      generatedAt: generatedAt(data),
      generatedBy: generatedBy(data),
      lastVerifiedAt: lastVerifiedAt(data),
      outbound: extractLinks(split.body, id),
    };
  }

  const tags = Array.isArray(data.tags)
    ? data.tags.filter((t): t is string => typeof t === "string")
    : [];

  return {
    project,
    id,
    file,
    revision,
    frontmatter: data,
    body: split.body,
    parseError: null,
    title: displayTitle(data, id),
    description: typeof data.description === "string" ? data.description : null,
    type: data.type,
    tags,
    status: effectiveStatus(data),
    trustTier: trustTier(data),
    staleAfter: staleAfter(data),
    generatedAt: generatedAt(data),
    generatedBy: generatedBy(data),
    lastVerifiedAt: lastVerifiedAt(data),
    outbound: extractLinks(split.body, id),
  };
}
