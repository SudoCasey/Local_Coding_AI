export type WritePermissionMode = 'allowlist' | 'runEverything';

export type WriteActionKind = 'apply' | 'insert' | 'shell';

/**
 * Canonical action type used for allowlist matching.
 * Shell commands use the first token family (e.g. "npm install x" → "npm").
 */
export function normalizeWriteActionType(kind: WriteActionKind, detail?: string): string {
  if (kind === 'apply' || kind === 'insert') {
    return kind;
  }

  const raw = (detail || '').trim();
  if (!raw) {
    return 'shell';
  }

  const quoted = raw.match(/^"([^"]+)"/);
  const first = quoted ? quoted[1] : raw.split(/\s+/)[0] || 'shell';
  const base = first
    .replace(/^.*[\\/]/, '')
    .replace(/\.(cmd|exe|bat|ps1)$/i, '')
    .toLowerCase();
  return base || 'shell';
}

export function describeWriteAction(actionType: string): string {
  switch (actionType) {
    case 'apply':
      return 'Apply to File';
    case 'insert':
      return 'Insert at Cursor';
    default:
      return `${actionType} …`;
  }
}

export function isWriteActionAllowlisted(actionType: string, allowlist: string[]): boolean {
  const target = actionType.toLowerCase();
  return allowlist.some((entry) => entry.trim().toLowerCase() === target);
}
