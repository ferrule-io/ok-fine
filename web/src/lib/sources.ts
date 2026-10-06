export interface SourceRef {
  id: string;
  resource: string;
  commit?: string;
  url: string | null;
  label: string;
}

export interface Verification {
  by: string;
  at?: string;
}

const GITHUB_CODE_RE = /^github\.com\/([^/]+)\/([^/]+)\/(.+)$/;
const GITLAB_CODE_RE = /^gitlab\.com\/([^/]+)\/([^/]+)\/(.+)$/;
const REPO_RE = /^(github|gitlab)\.com\/[^/]+\/[^/]+$/;
const HTTP_RE = /^https?:\/\//;

const KNOWN_FRONTMATTER_KEYS: Record<string, true> = {
  type: true,
  title: true,
  description: true,
  tags: true,
  status: true,
  generated: true,
  verified: true,
  sources: true,
  stale_after: true,
};

export function readSources(fm: Record<string, unknown> | null): SourceRef[] {
  if (!fm || typeof fm !== "object") {
    return [];
  }
  const rawSources = fm.sources;
  if (!Array.isArray(rawSources)) {
    return [];
  }

  const results: SourceRef[] = [];
  for (let i = 0; i < rawSources.length; i++) {
    const item = rawSources[i];
    if (!item || typeof item !== "object" || !("resource" in item) || typeof item.resource !== "string") {
      continue;
    }

    const resource = item.resource.trim();
    if (resource.length === 0) {
      continue;
    }

    const id =
      "id" in item && typeof item.id === "string" && item.id.trim().length > 0 ? item.id.trim() : `source-${i + 1}`;

    const commit =
      "commit" in item && typeof item.commit === "string" && item.commit.trim().length > 0
        ? item.commit.trim()
        : undefined;

    let url: string | null = null;
    let label = resource;

    if (HTTP_RE.test(resource)) {
      url = resource;
    } else {
      const ghMatch = GITHUB_CODE_RE.exec(resource);
      if (ghMatch?.[1] && ghMatch[2] && ghMatch[3]) {
        url = `https://github.com/${ghMatch[1]}/${ghMatch[2]}/blob/${commit ?? "HEAD"}/${ghMatch[3]}`;
        label = ghMatch[3];
      } else {
        const glMatch = GITLAB_CODE_RE.exec(resource);
        if (glMatch?.[1] && glMatch[2] && glMatch[3]) {
          url = `https://gitlab.com/${glMatch[1]}/${glMatch[2]}/-/blob/${commit ?? "HEAD"}/${glMatch[3]}`;
          label = glMatch[3];
        } else if (REPO_RE.test(resource)) {
          url = `https://${resource}`;
        }
      }
    }

    results.push({
      id,
      resource,
      ...(commit !== undefined ? { commit } : {}),
      url,
      label,
    });
  }

  return results;
}

export function readVerified(fm: Record<string, unknown> | null): Verification[] {
  if (!fm || typeof fm !== "object") {
    return [];
  }
  const raw = fm.verified;
  if (raw == null) {
    return [];
  }
  const list = Array.isArray(raw) ? raw : [raw];
  const results: Verification[] = [];

  for (const item of list) {
    if (item && typeof item === "object" && "by" in item && typeof item.by === "string" && item.by.length > 0) {
      const at = "at" in item && typeof item.at === "string" ? item.at : undefined;
      results.push(at !== undefined ? { by: item.by, at } : { by: item.by });
    }
  }

  return results;
}

export function extraFrontmatter(fm: Record<string, unknown> | null): Array<[string, unknown]> {
  if (!fm || typeof fm !== "object") {
    return [];
  }
  return Object.entries(fm).filter(([key]) => !(key in KNOWN_FRONTMATTER_KEYS));
}
