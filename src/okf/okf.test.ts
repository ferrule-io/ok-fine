import { describe, it, expect } from "vitest";
import {
  splitFrontmatter,
  parseFrontmatter,
  applyFrontmatter,
  serializeConcept,
} from "./frontmatter.js";
import {
  trustTier,
  effectiveStatus,
  isStale,
  parseActor,
} from "./semantics.js";
import {
  normalizeConceptIdForWrite,
  resolveReadPath,
} from "./paths.js";
import { extractLinks } from "./markdown.js";
import { renderIndex, type DirListing } from "./index-file.js";
import { prependLogEntry } from "./log-file.js";
import { lintConceptFile, lintLogFile } from "./lint.js";

describe("OKF Core", () => {
  it("frontmatter round-trip keeps comments, unknown keys, flow generated, and string timestamps", () => {
    const raw = `---
# Top comment
type: Reference
title: Initial Title
# Owner team comment
owner_team: team-a
date_field: 2026-06-30T14:00:00Z
verified: { by: human:alice, at: 2026-06-30T14:00:00Z }
generated: { by: test-agent/1.0, at: 2026-06-30T14:00:00Z }
---

# Body Content
`;

    const split = splitFrontmatter(raw)!;
    expect(split).not.toBeNull();
    const parsed = parseFrontmatter(split.yaml);
    expect("doc" in parsed).toBe(true);
    if (!("doc" in parsed)) return;

    // Verify date is string
    expect(typeof parsed.data.date_field).toBe("string");
    expect(parsed.data.date_field).toBe("2026-06-30T14:00:00Z");

    // Case 1: input echoes existing verified -> ignoredKeys empty
    const inputWithSameVerified = {
      type: "Reference",
      title: "Updated Title",
      owner_team: "team-a",
      date_field: "2026-06-30T14:00:00Z",
      verified: { by: "human:alice", at: "2026-06-30T14:00:00Z" },
    };

    const serverGen = { generated: { by: "test-agent/1.0", at: "2026-06-30T14:00:00Z" } };
    const res1 = applyFrontmatter(parsed.doc, inputWithSameVerified, serverGen);
    expect(res1.ignoredKeys).toEqual([]);

    const serialized = serializeConcept(res1.doc, split.body);
    expect(serialized).toContain("# Top comment");
    expect(serialized).toContain("# Owner team comment");
    expect(serialized).toContain("owner_team: team-a");
    expect(serialized).toContain("title: Updated Title");

    // Case 2: input with different verified -> ignoredKeys has ["verified"]
    const inputWithDiffVerified = {
      ...inputWithSameVerified,
      verified: { by: "human:bob", at: "2026-07-01T00:00:00Z" },
    };
    const res2 = applyFrontmatter(parsed.doc, inputWithDiffVerified, serverGen);
    expect(res2.ignoredKeys).toEqual(["verified"]);
  });

  it("determines trust tier correctly", () => {
    expect(trustTier({})).toBe("unverified");
    expect(trustTier({ verified: [] })).toBe("unverified");
    expect(trustTier({ verified: { by: "human:a", at: "2026-01-01T00:00:00Z" } })).toBe("human-reviewed");
    expect(trustTier({ verified: [{ by: "process:x" }] })).toBe("machine-confirmed");
  });

  it("staleness boundary and effective status", () => {
    const staleAfterStr = "2026-10-05T12:00:00Z";
    const boundary = new Date(staleAfterStr);
    const oneSecBefore = new Date(boundary.getTime() - 1000);

    expect(isStale({ stale_after: staleAfterStr }, boundary)).toBe(true);
    expect(isStale({ stale_after: staleAfterStr }, oneSecBefore)).toBe(false);

    expect(effectiveStatus({})).toBe("stable");
    expect(effectiveStatus({ status: "draft" })).toBe("draft");
    expect(effectiveStatus({ status: "deprecated" })).toBe("deprecated");
    expect(effectiveStatus({ status: "unknown" })).toBe("stable");
  });

  it("parseActor validates according to convention", () => {
    expect(parseActor("reference_agent/gemini-2.5-pro")).toEqual({
      kind: "agent",
      id: "reference_agent/gemini-2.5-pro",
    });
    expect(parseActor("human:ahormati")).toEqual({
      kind: "human",
      id: "ahormati",
    });
    expect(parseActor("process:finance-nightly")).toEqual({
      kind: "process",
      id: "finance-nightly",
    });

    expect(parseActor("team:x")).toBeNull();
    expect(parseActor("ahormati")).toBeNull();
    expect(parseActor("human:")).toBeNull();
  });

  it("path rules for concepts and reads", () => {
    expect(() => normalizeConceptIdForWrite("tables/index")).toThrow();
    expect(() => normalizeConceptIdForWrite("../x")).toThrow();
    expect(normalizeConceptIdForWrite("/tables/orders.md")).toBe("tables/orders");

    expect(() => resolveReadPath("../x")).toThrow();
    expect(() => resolveReadPath("a/../b")).toThrow();
    expect(() => resolveReadPath("a/.b")).toThrow();
    expect(resolveReadPath("/tables/orders.md")).toBe("tables/orders.md");
  });

  it("extractLinks extracts valid internal concept links and skips fenced code blocks and external links", () => {
    const body = `
See [Customers](/tables/customers.md) and [Revenue](../computations/revenue.md).
Also external [External](https://example.com) and hash [Anchor](#heading).

\`\`\`markdown
[Fenced Ignored](/tables/fenced.md)
\`\`\`
`;
    const links = extractLinks(body, "metrics/x");
    expect(links).toEqual(["tables/customers", "computations/revenue"]);
  });

  it("renderIndex golden string for a root with two types, a file, and a subdirectory", () => {
    const listing: DirListing = {
      isRoot: true,
      concepts: [
        {
          file: "tables/orders.md",
          title: "Orders",
          description: "Customer orders table",
          type: "Reference",
        },
        {
          file: "decisions/db.md",
          title: "Database Choice",
          description: null,
          type: "Decision",
        },
      ],
      files: ["schema.sql"],
      dirs: [
        {
          name: "tables",
          conceptCount: 1,
          fileCount: 0,
        },
      ],
    };

    const rendered = renderIndex(listing);
    expect(rendered).toBe(`---
okf_version: "0.2"
---

# Decision
* [Database Choice](decisions/db.md)

# Reference
* [Orders](tables/orders.md) - Customer orders table

# Files
* [schema.sql](schema.sql)

# Directories
* [tables](tables/) - 1 concept
`);
  });

  it("prependLogEntry same-day vs new-day vs missing file", () => {
    // Missing file
    const initial = prependLogEntry(null, "2026-10-05", "Entry 1");
    expect(initial).toBe(`# Update Log

## 2026-10-05
* Entry 1
`);

    // Same day
    const sameDay = prependLogEntry(initial, "2026-10-05", "Entry 2");
    expect(sameDay).toBe(`# Update Log

## 2026-10-05
* Entry 2
* Entry 1
`);

    // New day
    const newDay = prependLogEntry(sameDay, "2026-10-06", "Entry 3");
    expect(newDay).toBe(`# Update Log

## 2026-10-06
* Entry 3

## 2026-10-05
* Entry 2
* Entry 1
`);
  });

  it("lint checks conforming and invalid files", () => {
    // Appendix A text (Attested Computation with single code block under # Computation)
    const appendixA = `---
type: Attested Computation
title: Revenue Computation
runtime: python:3.11
parameters:
  - name: year
    type: integer
---

# Computation

\`\`\`python
def compute():
    return 42
\`\`\`
`;
    const mockCtx = {
      now: new Date("2026-10-05T12:00:00Z"),
      conceptExists: () => true,
      fileExists: () => true,
    };

    const issuesGood = lintConceptFile("computations/revenue.md", appendixA, mockCtx);
    const errorsAndWarningsGood = issuesGood.filter((i) => i.severity === "error" || i.severity === "warning");
    expect(errorsAndWarningsGood).toEqual([]);

    // Removing runtime
    const missingRuntime = appendixA.replace("runtime: python:3.11\n", "");
    const issuesMissingRuntime = lintConceptFile("computations/revenue.md", missingRuntime, mockCtx);
    expect(issuesMissingRuntime.some((i) => i.code === "computation_missing_runtime")).toBe(true);

    // Concept without type
    const missingType = appendixA.replace("type: Attested Computation\n", "");
    const issuesMissingType = lintConceptFile("computations/revenue.md", missingType, mockCtx);
    expect(issuesMissingType.some((i) => i.code === "missing_type")).toBe(true);

    // Bad date heading in log
    const badLog = `# Update Log

## May 5
* Some update
`;
    const logIssues = lintLogFile("log.md", badLog);
    expect(logIssues.some((i) => i.code === "log_bad_date_heading")).toBe(true);
  });
});
