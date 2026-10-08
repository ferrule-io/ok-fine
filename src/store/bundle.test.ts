import { describe, expect, it } from "vitest";
import { BundleTree, buildDirListing, lintBundle, planIndexes } from "./bundle.js";

const tree = new BundleTree([
  "overview.md",
  "index.md",
  "log.md",
  "a/x.md",
  "a/index.md",
  "a/b/y.txt",
  "a/b/index.md",
  "empty/index.md",
]);
const lookup = (): undefined => undefined;

describe("BundleTree", () => {
  it("root listing excludes dirs without content and reserved files", () => {
    const listing = buildDirListing(tree, "", lookup);
    expect(listing.dirs).toEqual([{ name: "a", conceptCount: 1, fileCount: 1 }]);
    expect(listing.concepts.map((c) => c.file)).toEqual(["overview.md"]);
    expect(listing.files).toEqual([]);
  });

  it("plans every index deepest-first and deletes indexes of content-less dirs", () => {
    const plan = planIndexes(tree, "all", lookup);
    const paths = plan.map((p) => p.path);
    expect(plan).toContainEqual({ path: "empty/index.md", content: null });
    expect(paths.indexOf("a/b/index.md")).toBeLessThan(paths.indexOf("a/index.md"));
    expect(paths.indexOf("a/index.md")).toBeLessThan(paths.indexOf("index.md"));
    expect(plan.find((p) => p.path === "index.md")?.content).toMatch(/^---\nokf_version: "0.2"\n---/);
  });

  it("plans a touched dir plus its ancestors only", () => {
    expect(planIndexes(tree, ["a/b"], lookup).map((p) => p.path)).toEqual(["a/b/index.md", "a/index.md", "index.md"]);
  });

  it("exists matches files and dirs inside the bundle only", () => {
    expect(tree.exists("a/b")).toBe(true);
    expect(tree.exists("/a/x.md")).toBe(true);
    expect(tree.exists("../x")).toBe(false);
    expect(tree.exists("nope")).toBe(false);
  });

  it("lintBundle emits broken_cross_link warning when cross-project target is missing", async () => {
    const source = {
      paths: ["overview.md", "index.md", "guide.md"],
      read: async (path: string) => {
        if (path === "index.md") return Buffer.from("# Index\n\n## Section\n* [Guide](guide.md)\n");
        if (path === "overview.md") return Buffer.from("---\ntype: Project\ntitle: Test\n---\nOverview\n");
        if (path === "guide.md") {
          return Buffer.from(
            "---\ntype: Guide\ntitle: Guide\n---\n[Tier](okf://org/glossary/tier) and [Missing](okf://org/missing)\n",
          );
        }
        return null;
      },
    };

    const res = await lintBundle(source, new Date(), {
      crossProjectConceptExists: (project, id) => project === "org" && id === "glossary/tier",
    });

    const warnings = res.issues.filter((i) => i.severity === "warning");
    expect(warnings.some((w) => w.code === "broken_cross_link")).toBe(true);
    const missingIssue = warnings.find((w) => w.code === "broken_cross_link");
    expect(missingIssue?.message).toContain("okf://org/missing");
    expect(missingIssue?.message).not.toContain("glossary/tier");
  });
});
