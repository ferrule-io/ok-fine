import { describe, expect, it } from "vitest";
import { applyFrontmatter, isoAfterDays, parseFrontmatter, serializeConcept, splitFrontmatter } from "./frontmatter.js";
import { type DirListing, renderIndex } from "./index-file.js";
import { lintConceptFile, lintLogFile } from "./lint.js";
import { prependLogEntry } from "./log-file.js";
import { extractCrossProjectLinks, extractLinks, parseCrossProjectTarget } from "./markdown.js";
import { normalizeConceptIdForWrite, resolveReadPath } from "./paths.js";
import { normalizeRepository } from "./repository.js";
import { effectiveStatus, isStale, parseActor, trustTier } from "./semantics.js";

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

    const split = splitFrontmatter(raw);
    expect(split).not.toBeNull();
    if (!split) return;
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
    expect(trustTier({ proposal: { ref: "https://example.com/pr/1" }, verified: [{ by: "human:a" }] })).toBe(
      "proposed",
    );
    expect(trustTier({ proposal: null, verified: [{ by: "process:x" }] })).toBe("machine-confirmed");
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

  it("extractLinks never treats footnote citations as concept links", () => {
    expect(extractLinks("x[^a]\n\n[^a]: other.md\n", "dir/c")).toEqual([]);
    expect(extractLinks("x[^a] and [B](b.md)\n\n[^a]: other.md\n", "dir/c")).toEqual(["dir/b"]);
  });

  it("parseCrossProjectTarget parses valid cross-project links and rejects traversal, invalid project names, and reserved names", () => {
    // Valid links
    expect(parseCrossProjectTarget("okf://org/glossary/tier")).toEqual({
      project: "org",
      id: "glossary/tier",
    });
    expect(parseCrossProjectTarget("okf://org/glossary/tier.md#x")).toEqual({
      project: "org",
      id: "glossary/tier",
    });
    expect(parseCrossProjectTarget("okf://org/glossary/tier?ref=1#x")).toEqual({
      project: "org",
      id: "glossary/tier",
    });
    expect(parseCrossProjectTarget("okf://org/tier")).toEqual({
      project: "org",
      id: "tier",
    });
    expect(parseCrossProjectTarget("okf://org/tier.md")).toEqual({
      project: "org",
      id: "tier",
    });

    // Rejects traversal
    expect(parseCrossProjectTarget("okf://org/../tier")).toBeNull();
    expect(parseCrossProjectTarget("okf://org/tier/..")).toBeNull();
    expect(parseCrossProjectTarget("okf://../tier")).toBeNull();
    expect(parseCrossProjectTarget("okf://org/a/../b")).toBeNull();

    // Rejects invalid project names
    expect(parseCrossProjectTarget("okf://Org/tier")).toBeNull();
    expect(parseCrossProjectTarget("okf://-org/tier")).toBeNull();
    expect(parseCrossProjectTarget("okf://org_name/tier")).toBeNull();
    expect(parseCrossProjectTarget("okf://org")).toBeNull();
    expect(parseCrossProjectTarget("okf://org/")).toBeNull();

    // Rejects reserved names
    expect(parseCrossProjectTarget("okf://org/index")).toBeNull();
    expect(parseCrossProjectTarget("okf://org/index.md")).toBeNull();
    expect(parseCrossProjectTarget("okf://org/log")).toBeNull();
    expect(parseCrossProjectTarget("okf://org/log.md")).toBeNull();
    expect(parseCrossProjectTarget("okf://org/sub/log")).toBeNull();

    // Rejects empty segments, backslashes, malformed URIs
    expect(parseCrossProjectTarget("okf://org//tier")).toBeNull();
    expect(parseCrossProjectTarget("okf://org/tier/")).toBeNull();
    expect(parseCrossProjectTarget("okf://org\\tier")).toBeNull();
    expect(parseCrossProjectTarget("https://org/tier")).toBeNull();
  });

  it("extractCrossProjectLinks extracts and deduplicates cross-project links, skipping intra-bundle links and footnote definitions", () => {
    const body = `
See [Tier](okf://org/glossary/tier) and duplicate [Tier Policy](okf://org/glossary/tier.md#frag).
Also intra-bundle [Local](local.md) and reference [SLA][sla-ref].

[^note]: okf://org/glossary/tier

[sla-ref]: okf://org/policies/sla
`;
    const links = extractCrossProjectLinks(body);
    expect(links).toEqual([
      { project: "org", id: "glossary/tier" },
      { project: "org", id: "policies/sla" },
    ]);
  });

  it("lintConceptFile warns on broken cross-project links when checker provided", () => {
    const text = `---
type: Reference
title: Guide
---

See [Tier](okf://org/glossary/tier) and [Missing](okf://org/missing/concept).
`;
    const issues = lintConceptFile("guide.md", text, {
      now: new Date(),
      conceptExists: () => true,
      fileExists: () => true,
      crossProjectConceptExists: (project, id) => project === "org" && id === "glossary/tier",
    });

    const warnings = issues.filter((i) => i.severity === "warning");
    expect(warnings.some((w) => w.code === "broken_cross_link")).toBe(true);
    const broken = warnings.find((w) => w.code === "broken_cross_link");
    expect(broken?.message).toContain("okf://org/missing/concept");
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

  it("lint checks sources for valid commit and safe resource", () => {
    const mockCtx = {
      now: new Date("2026-10-05T12:00:00Z"),
      conceptExists: () => true,
      fileExists: () => true,
    };

    // Clean source producing no warnings or errors
    const cleanConcept = `---
type: Decision
title: Clean Source
sources:
  - id: agents-md
    resource: github.com/ferrule-io/ok-fine/AGENTS.md
    commit: 02257c2f38b9ddc559bbda7eb00f906aa98a5ec1
---

# Decision

Clean content.
`;
    const cleanIssues = lintConceptFile("decisions/clean.md", cleanConcept, mockCtx);
    const cleanErrorsAndWarnings = cleanIssues.filter((i) => i.severity === "error" || i.severity === "warning");
    expect(cleanErrorsAndWarnings).toEqual([]);

    // Bad commit: present but not matching hex pattern (warning-level, never error)
    const badCommitConcept = `---
type: Decision
title: Bad Commit
sources:
  - id: agents-md
    resource: github.com/ferrule-io/ok-fine/AGENTS.md
    commit: not-a-valid-hex-commit
---

# Decision
`;
    const badCommitIssues = lintConceptFile("decisions/bad-commit.md", badCommitConcept, mockCtx);
    expect(badCommitIssues.filter((i) => i.severity === "error")).toEqual([]);
    const commitWarning = badCommitIssues.find((i) => i.code === "invalid_commit");
    expect(commitWarning).toBeDefined();
    expect(commitWarning?.severity).toBe("warning");

    // Short commit (<7 chars) produces invalid_commit warning
    const shortCommitConcept = `---
type: Decision
title: Short Commit
sources:
  - id: agents-md
    resource: github.com/ferrule-io/ok-fine/AGENTS.md
    commit: 123456
---

# Decision
`;
    const shortCommitIssues = lintConceptFile("decisions/short-commit.md", shortCommitConcept, mockCtx);
    expect(shortCommitIssues.some((i) => i.code === "invalid_commit" && i.severity === "warning")).toBe(true);

    // Bad resource: contains shell metacharacters or whitespace (warning-level, never error)
    for (const badChar of ["`", "$", ";", "|", "&", "<", ">", "(", ")", "\\", "\n", " ", "\t", "'", '"']) {
      const badResourceConcept = `---
type: Decision
title: Bad Resource
sources:
  - id: agents-md
    resource: ${JSON.stringify(`github.com/ferrule-io/ok-fine/AGENTS${badChar}md`)}
---

# Decision
`;
      const badResourceIssues = lintConceptFile("decisions/bad-resource.md", badResourceConcept, mockCtx);
      expect(badResourceIssues.filter((i) => i.severity === "error")).toEqual([]);
      const resourceWarning = badResourceIssues.find((i) => i.code === "invalid_resource");
      expect(resourceWarning).toBeDefined();
      expect(resourceWarning?.severity).toBe("warning");
    }
  });

  it("isoAfterDays calculates ISO 8601 UTC date offset by specified days", () => {
    const fixed = new Date("2026-10-05T12:00:00Z");
    expect(isoAfterDays(fixed, 180)).toBe("2027-04-03T12:00:00Z");
    expect(isoAfterDays(fixed, 0)).toBe("2026-10-05T12:00:00Z");
  });
});

describe("normalizeRepository", () => {
  it.each([
    ["git@github.com:Acme/Shop.git", "github.com/acme/shop"],
    ["https://user:tok@github.com/acme/shop.git/", "github.com/acme/shop"],
    ["ssh://git@github.com:22/acme/shop", "github.com/acme/shop"],
    ["github.com/acme/shop", "github.com/acme/shop"],
    ["https://gitlab.example.com/Group/Sub/Repo", "gitlab.example.com/group/sub/repo"],
    ["/home/me/repo", null],
    ["file:///tmp/x", null],
    ["acme/shop", null],
    ["C:\\repo", null],
    ["", null],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeRepository(input)).toBe(expected);
  });
});
