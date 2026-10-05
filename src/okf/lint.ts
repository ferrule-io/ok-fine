import { posix } from "node:path";
import { splitFrontmatter, parseFrontmatter } from "./frontmatter.js";
import {
  ISO_DATETIME,
  parseActor,
  isStale,
} from "./semantics.js";
import { extractLinks, extractFootnoteLabels, computationBlocks, hasLegacyCitations } from "./markdown.js";

export interface LintIssue {
  severity: "error" | "warning" | "info";
  code: string;
  path: string;
  message: string;
}

export function lintConceptFile(
  path: string,
  text: string,
  ctx: {
    now: Date;
    conceptExists(id: string): boolean;
    fileExists(bundlePath: string): boolean;
  }
): LintIssue[] {
  const issues: LintIssue[] = [];

  const split = splitFrontmatter(text);
  if (!split) {
    issues.push({
      severity: "error",
      code: "missing_frontmatter",
      path,
      message: "file is missing YAML frontmatter delimited by --- lines",
    });
    return issues;
  }

  const parsed = parseFrontmatter(split.yaml);
  if ("error" in parsed) {
    issues.push({
      severity: "error",
      code: parsed.error,
      path,
      message: parsed.message,
    });
    return issues;
  }

  const { data } = parsed;
  const body = split.body;

  // Concept ID = path without .md
  const conceptId = path.endsWith(".md") ? path.slice(0, -3) : path;

  // Type check (required)
  if (typeof data.type !== "string" || data.type.trim().length === 0) {
    issues.push({
      severity: "error",
      code: "missing_type",
      path,
      message: "frontmatter must contain a non-empty string type",
    });
  }

  // Recommended fields type validation
  if ("title" in data && data.title != null && typeof data.title !== "string") {
    issues.push({
      severity: "warning",
      code: "invalid_title",
      path,
      message: "title must be a string",
    });
  }

  if ("description" in data && data.description != null && typeof data.description !== "string") {
    issues.push({
      severity: "warning",
      code: "invalid_description",
      path,
      message: "description must be a string",
    });
  }

  if ("tags" in data && data.tags != null) {
    if (!Array.isArray(data.tags) || data.tags.some((t) => typeof t !== "string")) {
      issues.push({
        severity: "warning",
        code: "invalid_tags",
        path,
        message: "tags must be a list of strings",
      });
    }
  }

  if ("status" in data && data.status != null) {
    if (data.status !== "draft" && data.status !== "stable" && data.status !== "deprecated") {
      issues.push({
        severity: "warning",
        code: "invalid_status",
        path,
        message: 'status must be "draft", "stable", or "deprecated"',
      });
    }
  }

  // Timestamps validation
  if (data.generated && typeof data.generated === "object") {
    if (!("by" in data.generated) || typeof data.generated.by !== "string" || data.generated.by.trim().length === 0) {
      issues.push({
        severity: "warning",
        code: "generated_missing_by",
        path,
        message: "generated must contain a non-empty string by",
      });
    } else {
      if (!parseActor(data.generated.by)) {
        issues.push({
          severity: "warning",
          code: "invalid_actor",
          path,
          message: `generated.by "${data.generated.by}" is not a valid actor`,
        });
      }
    }

    if ("at" in data.generated && data.generated.at != null) {
      if (typeof data.generated.at !== "string" || !ISO_DATETIME.test(data.generated.at)) {
        issues.push({
          severity: "warning",
          code: "invalid_timestamp",
          path,
          message: "generated.at must be an ISO 8601 string with explicit UTC offset",
        });
      }
    }
  }

  if ("stale_after" in data && data.stale_after != null) {
    if (typeof data.stale_after !== "string" || !ISO_DATETIME.test(data.stale_after)) {
      issues.push({
        severity: "warning",
        code: "invalid_timestamp",
        path,
        message: "stale_after must be an ISO 8601 string with explicit UTC offset",
      });
    }
  }

  if (data.usage_window && typeof data.usage_window === "object") {
    if ("from" in data.usage_window && data.usage_window.from != null) {
      if (typeof data.usage_window.from !== "string" || !ISO_DATETIME.test(data.usage_window.from)) {
        issues.push({
          severity: "warning",
          code: "invalid_timestamp",
          path,
          message: "usage_window.from must be an ISO 8601 string with explicit UTC offset",
        });
      }
    }
    if ("to" in data.usage_window && data.usage_window.to != null) {
      if (typeof data.usage_window.to !== "string" || !ISO_DATETIME.test(data.usage_window.to)) {
        issues.push({
          severity: "warning",
          code: "invalid_timestamp",
          path,
          message: "usage_window.to must be an ISO 8601 string with explicit UTC offset",
        });
      }
    }
  }

  // Verified validation
  if ("verified" in data && data.verified != null) {
    const raw = data.verified;
    const isMapObj = typeof raw === "object" && !Array.isArray(raw);
    const isList = Array.isArray(raw);

    if (!isMapObj && !isList) {
      issues.push({
        severity: "warning",
        code: "invalid_verified",
        path,
        message: "verified must be a mapping or list of mappings",
      });
    } else {
      const entries: unknown[] = isList ? raw : [raw];
      for (const entry of entries) {
        if (!entry || typeof entry !== "object") {
          issues.push({
            severity: "warning",
            code: "invalid_verified",
            path,
            message: "verified entry must be an object with string by and at",
          });
          continue;
        }

        const byVal = "by" in entry && typeof entry.by === "string" ? entry.by : null;
        const atVal = "at" in entry && typeof entry.at === "string" ? entry.at : null;

        if (!byVal || !atVal) {
          issues.push({
            severity: "warning",
            code: "invalid_verified",
            path,
            message: "verified entry must contain non-empty string by and at",
          });
        } else {
          if (!parseActor(byVal)) {
            issues.push({
              severity: "warning",
              code: "invalid_actor",
              path,
              message: `verified.by "${byVal}" is not a valid actor`,
            });
          }
          if (!ISO_DATETIME.test(atVal)) {
            issues.push({
              severity: "warning",
              code: "invalid_timestamp",
              path,
              message: "verified[].at must be an ISO 8601 string with explicit UTC offset",
            });
          }
        }
      }
    }
  }

  // Sources validation
  const sourceIds = new Set<string>();
  if ("sources" in data && data.sources != null) {
    if (Array.isArray(data.sources)) {
      for (const src of data.sources) {
        if (!src || typeof src !== "object") {
          continue;
        }

        if (!("resource" in src) || typeof src.resource !== "string" || src.resource.trim().length === 0) {
          issues.push({
            severity: "warning",
            code: "source_missing_resource",
            path,
            message: "source must contain a non-empty string resource",
          });
        }

        if ("id" in src && typeof src.id === "string" && src.id.trim().length > 0) {
          if (sourceIds.has(src.id)) {
            issues.push({
              severity: "warning",
              code: "duplicate_source_id",
              path,
              message: `duplicate source id "${src.id}"`,
            });
          } else {
            sourceIds.add(src.id);
          }
        }

        if ("last_modified" in src && src.last_modified != null) {
          if (typeof src.last_modified !== "string" || !ISO_DATETIME.test(src.last_modified)) {
            issues.push({
              severity: "warning",
              code: "invalid_timestamp",
              path,
              message: "sources[].last_modified must be an ISO 8601 string with explicit UTC offset",
            });
          }
        }

        if ("usage_window" in src && src.usage_window && typeof src.usage_window === "object") {
          if ("from" in src.usage_window && src.usage_window.from != null) {
            if (typeof src.usage_window.from !== "string" || !ISO_DATETIME.test(src.usage_window.from)) {
              issues.push({
                severity: "warning",
                code: "invalid_timestamp",
                path,
                message: "sources[].usage_window.from must be an ISO 8601 string with explicit UTC offset",
              });
            }
          }
          if ("to" in src.usage_window && src.usage_window.to != null) {
            if (typeof src.usage_window.to !== "string" || !ISO_DATETIME.test(src.usage_window.to)) {
              issues.push({
                severity: "warning",
                code: "invalid_timestamp",
                path,
                message: "sources[].usage_window.to must be an ISO 8601 string with explicit UTC offset",
              });
            }
          }
        }
      }
    }
  }

  // Footnote check
  if (sourceIds.size > 0) {
    const footnotes = extractFootnoteLabels(body);
    for (const label of footnotes) {
      if (!sourceIds.has(label)) {
        issues.push({
          severity: "warning",
          code: "unknown_footnote_source",
          path,
          message: `footnote [^${label}] does not match any source id`,
        });
      }
    }
  }

  // Parameters validation
  if ("parameters" in data && data.parameters != null) {
    if (!Array.isArray(data.parameters)) {
      issues.push({
        severity: "warning",
        code: "invalid_parameters",
        path,
        message: "parameters must be a list",
      });
    } else {
      for (const p of data.parameters) {
        if (!p || typeof p !== "object" || !("name" in p) || typeof p.name !== "string" || p.name.trim().length === 0) {
          issues.push({
            severity: "warning",
            code: "invalid_parameters",
            path,
            message: "parameter entry must have a non-empty string name",
          });
        }
      }
    }
  }

  // Attested Computation validation
  if (data.type === "Attested Computation") {
    if (!("runtime" in data) || typeof data.runtime !== "string" || data.runtime.trim().length === 0) {
      issues.push({
        severity: "warning",
        code: "computation_missing_runtime",
        path,
        message: 'Attested Computation requires a non-empty "runtime" field',
      });
    }

    const blocks = computationBlocks(body);
    const hasComputationPath =
      "computation" in data && typeof data.computation === "string" && data.computation.trim().length > 0;

    if (!hasComputationPath && blocks !== 1) {
      issues.push({
        severity: "warning",
        code: "computation_ambiguous",
        path,
        message: "Attested Computation without computation path must have exactly one code block under # Computation",
      });
    } else if (hasComputationPath && blocks >= 1) {
      issues.push({
        severity: "warning",
        code: "computation_ambiguous",
        path,
        message: "Attested Computation with computation path must not have code blocks under # Computation",
      });
    }

    if (hasComputationPath && typeof data.computation === "string") {
      const isUrl = /^[a-z][a-z0-9+.-]*:/i.test(data.computation);
      if (!isUrl) {
        const compPath = data.computation.startsWith("/")
          ? data.computation.slice(1)
          : posix.normalize(posix.join(posix.dirname(path), data.computation));
        if (!ctx.fileExists(compPath)) {
          issues.push({
            severity: "warning",
            code: "computation_file_missing",
            path,
            message: `computation file "${data.computation}" not found in bundle`,
          });
        }
      }
    }
  }

  // Info: outbound links
  const links = extractLinks(body, conceptId);
  for (const target of links) {
    if (!ctx.conceptExists(target)) {
      issues.push({
        severity: "info",
        code: "broken_link",
        path,
        message: `link to concept "${target}" does not exist`,
      });
    }
  }

  // Info: stale
  if (isStale(data, ctx.now)) {
    issues.push({
      severity: "info",
      code: "stale",
      path,
      message: "concept is past its stale_after date",
    });
  }

  // Info: legacy timestamp
  if ("timestamp" in data && !("generated" in data)) {
    issues.push({
      severity: "info",
      code: "legacy_timestamp",
      path,
      message: 'concept uses legacy "timestamp" instead of "generated"',
    });
  }

  // Info: legacy citations
  if (hasLegacyCitations(body)) {
    issues.push({
      severity: "info",
      code: "legacy_citations",
      path,
      message: 'concept contains legacy "# Citations" section',
    });
  }

  return issues;
}

export function lintIndexFile(path: string, text: string, isRoot: boolean): LintIssue[] {
  const issues: LintIssue[] = [];
  const split = splitFrontmatter(text);

  let body = text;
  if (split) {
    body = split.body;
    if (!isRoot) {
      issues.push({
        severity: "error",
        code: "index_frontmatter",
        path,
        message: "non-root index.md must not contain frontmatter",
      });
    } else {
      const parsed = parseFrontmatter(split.yaml);
      if ("error" in parsed) {
        issues.push({
          severity: "error",
          code: parsed.error,
          path,
          message: parsed.message,
        });
      } else {
        const keys = Object.keys(parsed.data);
        for (const k of keys) {
          if (k !== "okf_version") {
            issues.push({
              severity: "error",
              code: "index_frontmatter",
              path,
              message: `root index.md frontmatter must only declare okf_version, found "${k}"`,
            });
          }
        }
        if ("okf_version" in parsed.data) {
          const ver = parsed.data.okf_version;
          if (ver !== "0.2" && ver !== "0.1") {
            issues.push({
              severity: "warning",
              code: "okf_version_unknown",
              path,
              message: `unknown okf_version "${String(ver)}"`,
            });
          }
        }
      }
    }
  }

  // Must have at least one line starting with '# '
  if (!/(?:^|\n)#[ \t]+[^\r\n]+/.test(body)) {
    issues.push({
      severity: "error",
      code: "index_no_sections",
      path,
      message: "index.md must contain at least one section heading",
    });
  }

  return issues;
}

export function lintLogFile(path: string, text: string): LintIssue[] {
  const issues: LintIssue[] = [];
  const headingRe = /(?:^|\n)##[ \t]+([^\r\n]+)/g;
  let match: RegExpExecArray | null;

  while ((match = headingRe.exec(text)) !== null) {
    const headingText = match[1]?.trim();
    if (!headingText || !/^\d{4}-\d{2}-\d{2}$/.test(headingText)) {
      issues.push({
        severity: "error",
        code: "log_bad_date_heading",
        path,
        message: `invalid date heading "${headingText ?? ""}", expected YYYY-MM-DD`,
      });
    }
  }

  return issues;
}
