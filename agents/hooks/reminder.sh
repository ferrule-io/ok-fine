#!/bin/sh
# Hook shared by Claude Code, Codex, and Gemini CLI for SessionStart (full
# reminder) and the per-prompt events UserPromptSubmit / BeforeAgent (one-line
# reminder until the transcript shows an ok-fine lookup).
# Injects the workspace's git remote so the agent can resolve its ok-fine project.
# Prints nothing (and exits 0) outside a git repository with a remote.

input=$(cat)

event=$(printf '%s\n' "$input" | sed -n 's/.*"hook_event_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | sed -n '1p')
[ -z "$event" ] && event="SessionStart"

case $event in
  SessionStart|UserPromptSubmit|BeforeAgent) ;;
  *) exit 0 ;;
esac

if [ "$event" = "UserPromptSubmit" ] || [ "$event" = "BeforeAgent" ]; then
  transcript_path=$(printf '%s\n' "$input" | sed -n 's/.*"transcript_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | sed -n '1p')
  pattern='"(name|tool|toolName|tool_name)" *: *"([^"]*ok[-_]fine[^"]*[_:/.-])?(list_projects|search_concepts|read_concept|get_index)"'
  if [ -n "$transcript_path" ] && [ -f "$transcript_path" ] && [ -r "$transcript_path" ] && grep -Eiq "$pattern" "$transcript_path" 2>/dev/null; then
    exit 0
  fi
fi

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

case $event in
  SessionStart)
    printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"ok-fine: this workspace is the git repository %s; its shared project knowledge is kept in the ok-fine MCP server, not in this codebase. Before planning or editing, call the ok-fine list_projects tool with repository set to %s, then search_concepts with key terms from the task, and read the relevant concepts with read_concept. Follow the ok-fine skill for drift checks and for recording knowledge afterwards. If no project matches, say so once and offer the ok-fine-onboard skill. If the ok-fine tools are unavailable, mention it once and continue."}}\n' "$url" "$url"
    ;;
  UserPromptSubmit|BeforeAgent)
    printf '{"hookSpecificOutput":{"hookEventName":"%s","additionalContext":"ok-fine reminder: before planning or editing, call list_projects with repository set to %s, then search_concepts with key terms from this task (skip if the ok-fine tools are unavailable)."}}\n' "$event" "$url"
    ;;
esac
