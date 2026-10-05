import { BundleTree } from "./bundle.js";

/** In-memory set of file paths per project, with a cached BundleTree snapshot per project. */
export class PathIndex {
  private readonly files = new Map<string, Set<string>>();
  private readonly trees = new Map<string, BundleTree>();

  projects(): string[] {
    return Array.from(this.files.keys())
      .filter((project) => (this.files.get(project)?.size ?? 0) > 0)
      .sort((a, b) => a.localeCompare(b, "en"));
  }

  tree(project: string): BundleTree {
    let tree = this.trees.get(project);
    if (!tree) {
      const files = this.files.get(project);
      tree = files && files.size > 0 ? new BundleTree(files) : BundleTree.EMPTY;
      this.trees.set(project, tree);
    }
    return tree;
  }

  setProject(project: string, paths: Iterable<string>): void {
    const files = new Set(paths);
    if (files.size === 0) {
      this.files.delete(project);
    } else {
      this.files.set(project, files);
    }
    this.trees.delete(project);
  }

  add(project: string, path: string): void {
    let files = this.files.get(project);
    if (!files) {
      files = new Set();
      this.files.set(project, files);
    }
    files.add(path);
    this.trees.delete(project);
  }

  remove(project: string, path: string): void {
    const files = this.files.get(project);
    if (files) {
      files.delete(path);
      if (files.size === 0) {
        this.files.delete(project);
      }
    }
    this.trees.delete(project);
  }

  clear(): void {
    this.files.clear();
    this.trees.clear();
  }
}
