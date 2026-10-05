#!/bin/sh
# SessionStart hook shared by Claude Code, Codex, and Gemini CLI.
# Injects the workspace's git remote so the agent can resolve its ok-fine project.
# Prints nothing (and exits 0) outside a git repository with a remote.

cat >/dev/null

dir=${CLAUDE_PROJECT_DIR:-$PWD}

url=$(git -C "$dir" remote get-url origin 2>/dev/null)
if [ -z "$url" ]; then
  name=$(git -C "$dir" remote 2>/dev/null | sed -n '1p')
  [ -n "$name" ] && url=$(git -C "$dir" remote get-url "$name" 2>/dev/null)
fi
[ -n "$url" ] || exit 0

# Drop credentials embedded in URL-form remotes (scheme://user:secret@host/...).
url=$(printf '%s\n' "$url" | sed -E 's#^([A-Za-z][A-Za-z0-9+.-]*://)[^/@]*@#\1#')

# Only emit URLs that need no JSON escaping.
case $url in
  *[!A-Za-z0-9@:/._~+%-]*) exit 0 ;;
esac

printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"ok-fine: this workspace is the git repository %s. Its shared project knowledge is kept in the ok-fine MCP server, not in this codebase. Before non-trivial work, call the ok-fine list_projects tool with repository set to %s, then follow the ok-fine skill. If no project matches, say so once and offer the ok-fine-onboard skill. If the ok-fine tools are unavailable, mention it once and continue."}}\n' "$url" "$url"
