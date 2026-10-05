export interface DirListing {
  isRoot: boolean;
  concepts: Array<{
    file: string;
    title: string;
    description: string | null;
    type: string | null;
  }>;
  files: string[];
  dirs: Array<{
    name: string;
    conceptCount: number;
    fileCount: number;
  }>;
}

export function renderIndex(listing: DirListing): string {
  const sections: string[] = [];

  // Group concepts by type
  const byType = new Map<string, Array<{
    file: string;
    title: string;
    description: string | null;
  }>>();

  for (const c of listing.concepts) {
    const typeKey = c.type && c.type.length > 0 ? c.type : "Other";
    let list = byType.get(typeKey);
    if (!list) {
      list = [];
      byType.set(typeKey, list);
    }
    list.push({ file: c.file, title: c.title, description: c.description });
  }

  const sortedTypes = Array.from(byType.keys()).sort((a, b) => a.localeCompare(b, "en"));

  for (const type of sortedTypes) {
    const items = byType.get(type)!;
    items.sort((a, b) => {
      const titleCmp = a.title.toLowerCase().localeCompare(b.title.toLowerCase(), "en");
      if (titleCmp !== 0) {
        return titleCmp;
      }
      return a.file.localeCompare(b.file, "en");
    });

    const lines: string[] = [`# ${type}`];
    for (const item of items) {
      const uri = encodeURI(item.file);
      if (item.description != null) {
        const collapsedDesc = item.description.replace(/\s+/g, " ").trim();
        lines.push(`* [${item.title}](${uri}) - ${collapsedDesc}`);
      } else {
        lines.push(`* [${item.title}](${uri})`);
      }
    }
    sections.push(lines.join("\n"));
  }

  // Non-markdown files
  if (listing.files.length > 0) {
    const sortedFiles = listing.files.slice().sort((a, b) => a.localeCompare(b, "en"));
    const lines: string[] = ["# Files"];
    for (const f of sortedFiles) {
      lines.push(`* [${f}](${encodeURI(f)})`);
    }
    sections.push(lines.join("\n"));
  }

  // Directories
  if (listing.dirs.length > 0) {
    const sortedDirs = listing.dirs.slice().sort((a, b) => a.name.localeCompare(b.name, "en"));
    const lines: string[] = ["# Directories"];
    for (const d of sortedDirs) {
      const uri = `${encodeURI(d.name)}/`;
      let countText: string;
      if (d.conceptCount > 0) {
        countText = d.conceptCount === 1 ? "1 concept" : `${d.conceptCount} concepts`;
      } else {
        countText = d.fileCount === 1 ? "1 file" : `${d.fileCount} files`;
      }
      lines.push(`* [${d.name}](${uri}) - ${countText}`);
    }
    sections.push(lines.join("\n"));
  }

  let body: string;
  if (sections.length === 0) {
    body = "# Concepts\n";
  } else {
    body = sections.join("\n\n") + "\n";
  }

  if (listing.isRoot) {
    return `---\nokf_version: "0.2"\n---\n\n` + body;
  }
  return body;
}
