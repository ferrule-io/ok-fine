function appendMessage(base: string, message?: string): string {
  if (!message) {
    return base;
  }
  const clean = message.replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim().slice(0, 500);
  if (clean.length === 0) {
    return base;
  }
  return `${base} ${clean}`;
}

export function logInitializationEntry(actor: string, message?: string): string {
  return appendMessage(`**Initialization**: Created project bundle (by ${actor}).`, message);
}

export function logCreationEntry(title: string, id: string, actor: string, message?: string): string {
  return appendMessage(`**Creation**: Added [${title}](/${id}.md) (by ${actor}).`, message);
}

export function logUpdateEntry(
  title: string,
  id: string,
  actor: string,
  deprecated: boolean,
  message?: string,
): string {
  if (deprecated) {
    return appendMessage(`**Deprecation**: Deprecated [${title}](/${id}.md) (by ${actor}).`, message);
  }
  return appendMessage(`**Update**: Updated [${title}](/${id}.md) (by ${actor}).`, message);
}

export function logVerificationEntry(title: string, id: string, actor: string, message?: string): string {
  return appendMessage(`**Verification**: Verified [${title}](/${id}.md) (by ${actor}).`, message);
}

export function logDeletionEntry(id: string, actor: string, message?: string): string {
  return appendMessage(`**Deletion**: Removed \`${id}\` (by ${actor}).`, message);
}

export function logMoveEntry(title: string, fromId: string, toId: string, actor: string): string {
  return `**Move**: Moved \`${fromId}\` to [${title}](/${toId}.md) (by ${actor}).`;
}

export function logFileUpdateEntry(path: string, actor: string, message?: string): string {
  return appendMessage(`**Update**: Wrote file \`${path}\` (by ${actor}).`, message);
}

export function logFileDeletionEntry(path: string, actor: string, message?: string): string {
  return appendMessage(`**Deletion**: Removed file \`${path}\` (by ${actor}).`, message);
}

export function logImportEntry(actor: string, message?: string): string {
  return appendMessage(`**Import**: Imported bundle archive (by ${actor}).`, message);
}

export function logConflictResolutionEntry(id: string, actor: string, message?: string): string {
  return appendMessage(`**Conflict resolution**: Resolved conflict \`${id}\` (by ${actor}).`, message);
}

export function prependLogEntry(
  existing: string | null,
  date: string, // YYYY-MM-DD UTC
  entry: string,
): string {
  let text = existing;
  if (!text || !/(?:^|\n)#[ \t]/.test(text)) {
    text = "# Update Log\n";
  }

  const headingMatch = /(?:^|\n)(##[ \t]+([^\r\n]+))(?:\r?\n|$)/.exec(text);

  if (headingMatch) {
    const fullMatch = headingMatch[0];
    const headingText = headingMatch[2]?.trim();
    const matchIndex = headingMatch.index;

    if (headingText === date) {
      const insertPos = matchIndex + fullMatch.length;
      return `${text.slice(0, insertPos)}* ${entry}\n${text.slice(insertPos)}`;
    } else {
      const isLeadingNewline = fullMatch.startsWith("\n");
      const insertPos = isLeadingNewline ? matchIndex + 1 : matchIndex;
      return `${text.slice(0, insertPos)}## ${date}\n* ${entry}\n\n${text.slice(insertPos)}`;
    }
  } else {
    const titleMatch = /(?:^|\n)(#[ \t]+[^\r\n]+)(?:\r?\n|$)/.exec(text);
    if (titleMatch) {
      const insertPos = titleMatch.index + titleMatch[0].length;
      const prefix = text.slice(0, insertPos);
      const suffix = text.slice(insertPos);
      const needsBlank = !prefix.endsWith("\n\n");
      const separator = needsBlank ? (prefix.endsWith("\n") ? "\n" : "\n\n") : "";
      return `${prefix}${separator}## ${date}\n* ${entry}\n${suffix}`;
    } else {
      return `# Update Log\n\n## ${date}\n* ${entry}\n`;
    }
  }
}
