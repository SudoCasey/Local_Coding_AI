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
        search: String(search ?? ''),
        replace: String(replace ?? ''),
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
        content: String(content ?? '').replace(/^\n/, ''),
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
  return `[TOOL RESULTS]\n${results.join('\n\n')}\n\nContinue the task. Prefer SEARCH/REPLACE or WRITE to apply remaining file changes. Use RUN only if execution is required.`;
}

export const AGENT_PROTOCOL_INSTRUCTIONS = `
FILE & EXECUTION PROTOCOL (mandatory when changing the project):
You can read and modify files in the workspace, and optionally run commands.

Writing/reading code does NOT require user approval. Executing code (shell, npm, node, git, python, etc.) DOES require approval via the host.

Use ONLY these blocks (paths relative to workspace root):

<<<READ path="src/example.ts">>>
<<<LIST path="src">>>
<<<SEARCH path="src/example.ts">>>
exact old text to find
<<<REPLACE>>>
exact new text
<<<END>>>
<<<WRITE path="src/new-file.ts">>>
full file contents
<<<END>>>
<<<RUN>>>
npm test
<<<END>>>

Rules:
1. Prefer SEARCH/REPLACE for edits. Use WRITE for new files or full rewrites.
2. READ files you need before editing. You may use multiple READ/LIST/SEARCH/WRITE blocks in one reply.
3. Actually apply changes with SEARCH/REPLACE or WRITE — do not only recommend code in markdown when the user asked you to change the project.
4. Use RUN only when a command must be executed. Never claim a command ran unless you emitted RUN.
5. After tool results are returned, continue until the task is done or you need more tools.
`.trim();
