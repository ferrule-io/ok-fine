const EXT_TO_LANG: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  sh: "bash",
  bash: "bash",
  py: "python",
  go: "go",
  rs: "rust",
  sql: "sql",
  md: "markdown",
  diff: "diff",
  patch: "diff",
  toml: "toml",
  html: "html",
  css: "css",
  java: "java",
  rb: "ruby",
  dockerfile: "dockerfile",
};

export function languageForPath(path: string): string | null {
  const filename = path.split("/").pop() ?? path;
  if (filename.toLowerCase() === "dockerfile") {
    return "dockerfile";
  }
  const dotIndex = filename.lastIndexOf(".");
  if (dotIndex === -1) {
    return null;
  }
  const ext = filename.slice(dotIndex + 1).toLowerCase();
  return EXT_TO_LANG[ext] ?? null;
}
