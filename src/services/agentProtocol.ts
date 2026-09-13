export type AgentToolKind = 'read' | 'list' | 'search_replace' | 'write' | 'run';

export interface AgentReadCall {
  kind: 'read';
  path: string;
}

export interface AgentListCall {
  kind: 'list';
  path: string;
}

export interface AgentSearchReplaceCall {
  kind: 'search_replace';
  path: string;
  search: string;
  replace: string;
}

export interface AgentWriteCall {
  kind: 'write';
  path: string;
  content: string;
}

export interface AgentRunCall {
  kind: 'run';
  command: string;
}

export type AgentToolCall =
  | AgentReadCall
  | AgentListCall
  | AgentSearchReplaceCall
  | AgentWriteCall
  | AgentRunCall;

export interface ParsedAgentResponse {
  displayText: string;
  toolCalls: AgentToolCall[];
  statusLines: string[];
}

const READ_RE = /<<<READ\s+path="([^"]+)"\s*>>>/gi;
const LIST_RE = /<<<LIST\s+path="([^"]*)"\s*>>>/gi;
const SEARCH_REPLACE_RE =
  /<<<SEARCH\s+path="([^"]+)"\s*>>>([\s\S]*?)<<<REPLACE>>>([\s\S]*?)<<<END>>>/gi;
const WRITE_RE = /<<<WRITE\s+path="([^"]+)"\s*>>>([\s\S]*?)<<<END>>>/gi;
const RUN_RE = /<<<RUN>>>([\s\S]*?)<<<END>>>/gi;

function normalizeRelPath(p: string): string {
  return String(p || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '');
}

const MARKDOWN_EXTS = new Set(['md', 'markdown', 'mdx']);

function fileExtension(relPath: string): string {
  const base = relPath.split(/[/\\]/).pop() || '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0) {
    return '';
  }
  return base.slice(dot + 1).toLowerCase();
}

function isFenceOpener(line: string): { lang: string } | null {
  const m = line.trim().match(/^```([a-zA-Z0-9_+-]*)\s*$/);
  return m ? { lang: (m[1] || '').toLowerCase() } : null;
}

function isFenceCloser(line: string): boolean {
  return line.trim() === '```';
}

/**
 * Models often wrap WRITE/REPLACE bodies in markdown fences (` ```css `,
 * ` ```javascript `, …). Those fences are not valid source. Strip a wrapping
 * fence when the whole payload is one code block.
 *
 * Markdown files keep an intentional inner fence (e.g. a README that is only a
 * bash example) unless the outer fence is `markdown`/`md`.
 */
export function stripWrappingMarkdownFence(raw: string, relPath: string = ''): string {
  let content = String(raw ?? '');
  for (let i = 0; i < 3; i++) {
    const next = unwrapOnce(content, relPath);
    if (next === content) {
      break;
    }
    content = next;
  }
  return content;
}

function unwrapOnce(content: string, relPath: string): string {
  if (!content.includes('```')) {
    return content;
  }

  const endedWithNewline = /\r?\n$/.test(content);
  const lines = content.split('\n');
  let start = 0;
  while (start < lines.length && lines[start].trim() === '') {
    start += 1;
  }
  if (start >= lines.length) {
    return content;
  }

  const open = isFenceOpener(lines[start]);
  if (!open) {
    return content;
  }

  const ext = fileExtension(relPath);
  const isMarkdownFile = MARKDOWN_EXTS.has(ext);
  if (isMarkdownFile && open.lang && open.lang !== 'markdown' && open.lang !== 'md') {
    return content;
  }

  let end = lines.length - 1;
  while (end > start && lines[end].trim() === '') {
    end -= 1;
  }

  let inner: string[];
  if (end > start && isFenceCloser(lines[end])) {
    inner = lines.slice(start + 1, end);
  } else {
    const rest = lines.slice(start + 1);
    const hasOtherFence = rest.some((line) => isFenceOpener(line) || isFenceCloser(line));
    if (hasOtherFence) {
      return content;
    }
    inner = rest;
  }

  let unwrapped = inner.join('\n');
  if (endedWithNewline && !/\r?\n$/.test(unwrapped)) {
    unwrapped += '\n';
  }
  return unwrapped;
}

/**
 * Parse assistant output for agent tool/edit protocol blocks and produce
 * user-visible text with those blocks stripped.
 */
export function parseAgentResponse(raw: string): ParsedAgentResponse {
  const toolCalls: AgentToolCall[] = [];
  const statusLines: string[] = [];
  let text = raw || '';

  text = text.replace(READ_RE, (_m, p1: string) => {
    const path = normalizeRelPath(p1);
    if (path) {
      toolCalls.push({ kind: 'read', path });
      statusLines.push(`Reading \`${path}\`…`);
    }
    return '';
  });

  text = text.replace(LIST_RE, (_m, p1: string) => {
    const path = normalizeRelPath(p1) || '.';
    toolCalls.push({ kind: 'list', path });
    statusLines.push(`Listing \`${path}\`…`);
    return '';
  });

  text = text.replace(SEARCH_REPLACE_RE, (_m, p1: string, search: string, replace: string) => {
    const path = normalizeRelPath(p1);
    if (path) {
      toolCalls.push({
        kind: 'search_replace',
        path,
        search: stripWrappingMarkdownFence(String(search ?? ''), path),
        replace: stripWrappingMarkdownFence(String(replace ?? ''), path),
      });
      statusLines.push(`Edited \`${path}\``);
    }
    return '';
  });

  text = text.replace(WRITE_RE, (_m, p1: string, content: string) => {
    const path = normalizeRelPath(p1);
    if (path) {
      toolCalls.push({
        kind: 'write',
        path,
        content: stripWrappingMarkdownFence(String(content ?? '').replace(/^\n/, ''), path),
      });
      statusLines.push(`Wrote \`${path}\``);
    }
    return '';
  });

  text = text.replace(RUN_RE, (_m, command: string) => {
    const cmd = String(command ?? '').trim();
    if (cmd) {
      toolCalls.push({ kind: 'run', command: cmd });
      const preview = cmd.length > 60 ? `${cmd.slice(0, 57)}…` : cmd;
      statusLines.push(`Run \`${preview}\``);
    }
    return '';
  });

  // Collapse excessive blank lines left by stripping blocks
  const displayText = text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { displayText, toolCalls, statusLines };
}

export function hasAgentToolCalls(calls: AgentToolCall[]): boolean {
  return calls.length > 0;
}

export function formatToolResultsForModel(results: string[]): string {
  if (results.length === 0) {
    return '';
  }
  return `[TOOL RESULTS]\n${results.join('\n\n')}\n\nContinue the task now. READ more files if needed, then apply remaining edits with SEARCH/REPLACE or WRITE. Do not ask the user for more details. Use RUN only if a command must execute.`;
}

export function looksLikeWorkspaceTask(prompt: string): boolean {
  const p = String(prompt || '').trim();
  if (!p) {
    return false;
  }
  if (/^(what(?:'s| is| are)?|why|how come|explain|who|when|define)\b/i.test(p)) {
    return false;
  }
  return (
    /\b(fix|improve|refactor|remove|add|audit|edit|update|change|implement|create|delete|clean|optimize|performance|syntax|comment|error|bug|this (?:app|repo|project|code(?:base)?)|the (?:app|repo|project))\b/i.test(
      p
    ) || /```/.test(p)
  );
}

export const NO_TOOLS_NUDGE =
  'You replied without using LIST, READ, SEARCH/REPLACE, or WRITE. Inspect the open workspace with LIST and READ, then apply the user request with SEARCH/REPLACE or WRITE. Do not ask the user to describe the project. Do not refuse.';

export const AGENT_PROTOCOL_INSTRUCTIONS = `
FILE & EXECUTION PROTOCOL:
You inspect and edit the opened workspace. Act; do not stall.

Writing files does not need approval. Running shell commands does.

Use these blocks (paths relative to workspace root):

<<<LIST path=".">>>
<<<READ path="src/example.ts">>>
<<<SEARCH path="src/example.ts">>>
exact old text to find
<<<REPLACE>>>
exact new text
<<<END>>>
<<<WRITE path="src/new-file.ts">>>
export const x = 1;
<<<END>>>
<<<RUN>>>
npm test
<<<END>>>

Rules:
1. For project work, start with LIST and READ. Never ask the user to describe the repo, app, or current files — look them up.
2. When asked to change, fix, improve, audit, or clean the project, apply edits with SEARCH/REPLACE or WRITE in this turn. Do not refuse. Do not reply with only a request for more context.
3. Prefer SEARCH/REPLACE for edits. Use WRITE for new files or full rewrites.
4. Inside WRITE and REPLACE, emit only the file source. Do not wrap it in a markdown code block (no triple-backtick language tag before the code). The host already has the path and will strip wrappers if you add them.
5. Use RUN only when a command must execute. Never claim a command ran unless you emitted RUN.
6. After tool results, keep going until the task is done.
`.trim();
