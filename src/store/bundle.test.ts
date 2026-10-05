import { describe, expect, it } from "vitest";
import { BundleTree, buildDirListing, planIndexes } from "./bundle.js";

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
    expect(planIndexes(tree, ["a/b"], lookup).map((p) => p.path)).toEqual([
      "a/b/index.md",
      "a/index.md",
      "index.md",
    ]);
  });

  it("exists matches files and dirs inside the bundle only", () => {
    expect(tree.exists("a/b")).toBe(true);
    expect(tree.exists("/a/x.md")).toBe(true);
    expect(tree.exists("../x")).toBe(false);
    expect(tree.exists("nope")).toBe(false);
  });
});
