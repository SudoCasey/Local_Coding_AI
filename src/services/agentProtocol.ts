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

const READ_RE = /<<<\s*READ\s+path="([^"]+)"\s*>>>/gi;
const LIST_RE = /<<<\s*LIST\s+path="([^"]*)"\s*>>>/gi;
const SEARCH_REPLACE_RE =
  /<<<\s*SEARCH\s+path="([^"]+)"\s*>>>([\s\S]*?)<<<\s*REPLACE\s*>>>([\s\S]*?)<<<\s*END\s*>>>/gi;
const REPLACE_PATH_RE =
  /<<<\s*REPLACE\s+path="([^"]+)"\s*>>>([\s\S]*?)<<<\s*END\s*>>>/gi;
const WRITE_RE = /<<<\s*WRITE\s+path="([^"]+)"\s*>>>([\s\S]*?)<<<\s*END\s*>>>/gi;
const RUN_RE = /<<<\s*RUN\s*>>>([\s\S]*?)<<<\s*END\s*>>>/gi;

const PATH_CMDS = 'LIST|READ|SEARCH|WRITE|REPLACE';
const BARE_CMDS = 'REPLACE|END|RUN';
const TOOL_NAME_ALIASES: Record<string, string> = {
  LIST: 'LIST',
  LIST_DIR: 'LIST',
  LISTDIR: 'LIST',
  LS: 'LIST',
  READ: 'READ',
  READ_FILE: 'READ',
  READFILE: 'READ',
  OPEN: 'READ',
  SEARCH: 'SEARCH',
  SEARCH_REPLACE: 'SEARCH',
  STRREPLACE: 'SEARCH',
  WRITE: 'WRITE',
  WRITE_FILE: 'WRITE',
  WRITEFILE: 'WRITE',
  CREATE: 'WRITE',
  RUN: 'RUN',
  SHELL: 'RUN',
  EXEC: 'RUN',
  BASH: 'RUN',
};

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
  return stripTrailingMarkdownFences(content, relPath);
}

/** Drop leftover fence closer/opener lines at the end of non-markdown files. */
export function stripTrailingMarkdownFences(raw: string, relPath: string = ''): string {
  const ext = fileExtension(relPath);
  if (MARKDOWN_EXTS.has(ext)) {
    return String(raw ?? '');
  }
  const original = String(raw ?? '');
  const endedWithNewline = /\r?\n$/.test(original);
  const lines = original.split('\n');
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
    lines.pop();
  }
  let changed = false;
  while (lines.length > 0) {
    const t = lines[lines.length - 1].trim();
    if (t === '```' || /^```[a-zA-Z0-9_+-]*$/.test(t)) {
      lines.pop();
      changed = true;
      while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
        lines.pop();
      }
      continue;
    }
    break;
  }
  if (!changed) {
    return original;
  }
  let out = lines.join('\n');
  if (endedWithNewline && out.length > 0 && !/\r?\n$/.test(out)) {
    out += '\n';
  }
  return out;
}

/**
 * Qwen and similar models sometimes wrap the whole reply in JSON
 * (`{"response":"..."}`) or a json code fence. Unwrap so protocol blocks
 * and chat text can be parsed. Inner `path="."` quotes often break JSON.parse.
 */
export function unwrapModelEnvelope(raw: string): string {
  let text = String(raw ?? '').trim();
  if (!text) {
    return String(raw ?? '');
  }
  for (let i = 0; i < 3; i++) {
    const fenced = text.match(/^```(?:json)?\s*\r?\n([\s\S]*?)\r?\n```$/i);
    if (fenced) {
      text = fenced[1].trim();
      continue;
    }
    break;
  }
  const obj = tryParseJsonObject(text);
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    const inner = [obj.response, obj.message, obj.content, obj.text].find(
      (v) => typeof v === 'string' && v.trim().length > 0
    ) as string | undefined;
    if (inner) {
      return unwrapModelEnvelope(inner);
    }
  }
  const loose = extractLooseJsonStringField(text, ['response', 'message', 'content', 'text']);
  if (loose && loose.trim() && loose.trim() !== text) {
    return unwrapModelEnvelope(loose);
  }
  return text === String(raw ?? '').trim() ? String(raw ?? '') : text;
}

function extractLooseJsonStringField(text: string, keys: string[]): string | undefined {
  const trimmed = String(text ?? '').trim();
  if (!trimmed.startsWith('{')) {
    return undefined;
  }
  for (const key of keys) {
    const re = new RegExp(`"${key}"\\s*:\\s*"`, 'i');
    const m = re.exec(trimmed);
    if (!m) {
      continue;
    }
    const from = trimmed.slice(m.index + m[0].length);
    const close = from.match(/"\s*\}\s*$/);
    if (!close || close.index === undefined) {
      continue;
    }
    return decodeJsonStringish(from.slice(0, close.index));
  }
  return undefined;
}

function decodeJsonStringish(s: string): string {
  return String(s ?? '')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

function tryParseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

function canonToolName(raw: string): string | undefined {
  const key = String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[-\s]+/g, '_');
  return TOOL_NAME_ALIASES[key];
}

function quotePath(p: string): string {
  return String(p || '')
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/\\/g, '/');
}

/**
 * Rewrite malformed tool tags into <<< >>> so the canonical parser can run them.
 *
 * Small local models (especially Qwen 7B) invent delimiters: double backticks,
 * markdown fences, XML, JSON, square brackets, missing quotes, etc.
 */
export function normalizeProtocolDelimiters(raw: string): string {
  let text = String(raw ?? '');
  text = unwrapWrappingFenceIfProtocol(text);
  text = recoverJsonToolEnvelope(text);

  text = text.replace(/[«‹【『]/g, '<').replace(/[»›】』]/g, '>');

  text = text.replace(
    /[\[{]{2,3}\s*(LIST|READ|SEARCH|WRITE|REPLACE)\s+path\s*=\s*["'`]?([^"'\]}\n]+)["'`]?\s*[\]}]{2,3}/gi,
    (_m, cmd: string, filePath: string) => `<<<${String(cmd).toUpperCase()} path="${quotePath(filePath)}">>>`
  );

  text = text.replace(
    /(?<!<)<\/?(LIST|READ|SEARCH|WRITE|REPLACE|END|RUN)\b([^>]*)\/?>(?!>)/gi,
    (full: string, cmd: string, attrs: string) => {
      const name = String(cmd).toUpperCase();
      const pathMatch = String(attrs || '').match(/path\s*=\s*["'`]([^"'`]+)["'`]/i);
      if (pathMatch && (name === 'LIST' || name === 'READ' || name === 'SEARCH' || name === 'WRITE' || name === 'REPLACE')) {
        return `<<<${name} path="${quotePath(pathMatch[1])}">>>`;
      }
      if (name === 'END' || /^<\//.test(full)) {
        return '<<<END>>>';
      }
      if (name === 'RUN') {
        return '<<<RUN>>>';
      }
      if (name === 'REPLACE') {
        return '<<<REPLACE>>>';
      }
      return full;
    }
  );

  text = text.replace(
    /[`<]{1,6}\s*(LIST|READ|SEARCH|WRITE|REPLACE)\s+path\s*=\s*["'`]?([^"'>`\n]+?)["'`]?\s*[`>]{1,6}/gi,
    (_m, cmd: string, filePath: string) => `<<<${String(cmd).toUpperCase()} path="${quotePath(filePath)}">>>`
  );

  text = text.replace(
    /[`<]{1,6}\s*(REPLACE|END|RUN)\s*[`>]{1,6}/gi,
    (_m, cmd: string) => `<<<${String(cmd).toUpperCase()}>>>`
  );

  text = text.replace(
    /^\s*(LIST|READ|WRITE)\s*\(\s*["']([^"']+)["']\s*\)\s*$/gim,
    (_m, cmd: string, filePath: string) => `<<<${String(cmd).toUpperCase()} path="${quotePath(filePath)}">>>`
  );

  text = text.replace(
    /^\s*(LIST|READ|SEARCH|WRITE|REPLACE)\s+path\s*=\s*["'`]?([^"'`\n]+?)["'`]?\s*$/gim,
    (_m, cmd: string, filePath: string) => `<<<${String(cmd).toUpperCase()} path="${quotePath(filePath)}">>>`
  );

  text = text.replace(
    /^\s*(LIST|READ)\s+(\.|[.\w-]+\/[.\w/-]+|[.\w/-]+\.[a-zA-Z0-9]{1,10})\s*$/gim,
    (_m, cmd: string, filePath: string) => `<<<${String(cmd).toUpperCase()} path="${quotePath(filePath)}">>>`
  );

  text = text.replace(
    /<<<\s*(LIST|READ|SEARCH|WRITE|REPLACE)\s+path\s*=\s*["']?([^"'\n>]+?)["']?\s*>>>/gi,
    (_m, cmd: string, filePath: string) => `<<<${String(cmd).toUpperCase()} path="${quotePath(filePath)}">>>`
  );

  text = text.replace(
    /<<<\s*(REPLACE|END|RUN)\s*>>>/gi,
    (_m, cmd: string) => `<<<${String(cmd).toUpperCase()}>>>`
  );

  text = text.replace(
    /<<<(LIST|READ|SEARCH|WRITE|REPLACE)\s+path="([^"]+)"\s*$/gim,
    (_m, cmd: string, filePath: string) => `<<<${cmd} path="${filePath}">>>`
  );

  return closeUnterminatedBlocks(text);
}

function unwrapWrappingFenceIfProtocol(text: string): string {
  const trimmed = String(text ?? '').trim();
  const fenced = trimmed.match(/^```[a-zA-Z0-9_+-]*\s*\r?\n([\s\S]*?)\r?\n```$/);
  if (!fenced) {
    return text;
  }
  const inner = fenced[1].trim();
  if (new RegExp(`\\b(?:${PATH_CMDS}|${BARE_CMDS})\\b`, 'i').test(inner)) {
    return inner;
  }
  return text;
}

function recoverJsonToolEnvelope(text: string): string {
  const trimmed = String(text ?? '').trim();
  const asArray = tryParseJsonArray(trimmed);
  if (asArray) {
    const blocks = asArray.map(jsonObjectToProtocol).filter(Boolean);
    if (blocks.length > 0) {
      return blocks.join('\n');
    }
  }
  const obj = tryParseJsonObject(trimmed);
  if (!obj) {
    return text;
  }
  const block = jsonObjectToProtocol(obj);
  return block || text;
}

function jsonObjectToProtocol(obj: Record<string, unknown>): string {
  const name = canonToolName(String(obj.tool ?? obj.name ?? obj.action ?? obj.command ?? obj.type ?? ''));
  const argsRaw = obj.arguments ?? obj.parameters ?? obj.params ?? obj.args;
  const args =
    argsRaw && typeof argsRaw === 'object' && !Array.isArray(argsRaw)
      ? (argsRaw as Record<string, unknown>)
      : obj;
  const filePath = quotePath(String(args.path ?? args.file ?? args.filepath ?? args.target ?? obj.path ?? ''));
  if (name === 'LIST') {
    return `<<<LIST path="${filePath || '.'}">>>`;
  }
  if (name === 'READ' && filePath) {
    return `<<<READ path="${filePath}">>>`;
  }
  if (name === 'WRITE' && filePath) {
    const content = String(args.content ?? args.body ?? args.text ?? obj.content ?? '');
    return `<<<WRITE path="${filePath}">>>\n${content}\n<<<END>>>`;
  }
  if (name === 'SEARCH' && filePath) {
    const search = String(args.search ?? args.old ?? args.find ?? '');
    const replace = String(args.replace ?? args.new ?? args.replacement ?? '');
    return `<<<SEARCH path="${filePath}">>>\n${search}\n<<<REPLACE>>>\n${replace}\n<<<END>>>`;
  }
  if (name === 'RUN') {
    const command = String(args.command ?? args.cmd ?? args.shell ?? obj.command ?? '').trim();
    if (command) {
      return `<<<RUN>>>\n${command}\n<<<END>>>`;
    }
  }
  return '';
}

function tryParseJsonArray(text: string): Record<string, unknown>[] | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) {
      return null;
    }
    const objs = parsed.filter((x) => x && typeof x === 'object' && !Array.isArray(x));
    return objs.length > 0 ? objs : null;
  } catch {
    return null;
  }
}

function closeUnterminatedBlocks(text: string): string {
  let out = String(text ?? '');
  const opens = (out.match(/<<<\s*(WRITE|SEARCH|RUN)\b/gi) || []).length;
  const ends = (out.match(/<<<\s*END\s*>>>/gi) || []).length;
  if (opens > ends) {
    out = out.replace(/\s*```\s*$/, '');
    out += `${'\n<<<END>>>'.repeat(opens - ends)}`;
  }
  return out;
}

/** True when a LIST path looks like a file (use READ) rather than a directory. */
export function looksLikeFilePath(relPath: string): boolean {
  const base = (String(relPath || '').split(/[/\\]/).pop() || '').trim();
  if (!base || base === '.' || base === '..') {
    return false;
  }
  const dot = base.lastIndexOf('.');
  if (dot <= 0) {
    return false;
  }
  const ext = base.slice(dot + 1);
  return /^[a-zA-Z0-9]+$/.test(ext) && ext.length <= 10;
}

/** True when leftover text is a failed/raw tool tag, not user-facing prose. */
export function looksLikeProtocolNoise(text: string): boolean {
  const t = String(text || '').trim();
  if (!t) {
    return true;
  }
  const stripped = stripDanglingProtocolLines(t)
    .replace(/<<<\s*(?:LIST|READ|SEARCH|WRITE|REPLACE|END|RUN)\b[^>]*>>>/gi, '')
    .replace(/^\s*```[a-zA-Z0-9_+-]*\s*$/gm, '')
    .trim();
  if (!stripped) {
    return true;
  }
  if (stripped.length < 160 && /^(?:LIST|READ|SEARCH|WRITE|RUN|REPLACE|END)\b/i.test(stripped)) {
    return true;
  }
  if (/^\{\s*"response"\s*:/i.test(t) || /^\{\s*\n\s*"response"\s*:/i.test(t)) {
    return true;
  }
  return false;
}

export function stripDanglingProtocolLines(text: string): string {
  return String(text ?? '')
    .split('\n')
    .filter((line) => !isDanglingProtocolLine(line))
    .join('\n');
}

function isDanglingProtocolLine(line: string): boolean {
  const t = line.trim();
  if (!t) {
    return false;
  }
  if (/^[`<[{]{1,6}\s*(LIST|READ|SEARCH|WRITE|REPLACE|END|RUN)\b/i.test(t)) {
    return true;
  }
  if (/^(LIST|READ|SEARCH|WRITE)\s+path\s*=/i.test(t)) {
    return true;
  }
  if (/^(LIST|READ|WRITE)\s*\(\s*["']/i.test(t)) {
    return true;
  }
  if (/^<<<\s*(LIST|READ|SEARCH|WRITE|REPLACE|END|RUN)\b/i.test(t)) {
    return true;
  }
  if (/^<\/?(LIST|READ|SEARCH|WRITE|REPLACE|END|RUN)\b/i.test(t)) {
    return true;
  }
  if (/^(REPLACE|END|RUN)\s*$/i.test(t)) {
    return true;
  }
  return false;
}

function splitImplicitSearchReplace(body: string): { search: string; replace: string } | null {
  const raw = String(body ?? '').trim();
  if (!raw) {
    return null;
  }
  if (/exact old text to find/i.test(raw) && /exact new text/i.test(raw)) {
    return null;
  }
  const parts = raw.split(/\n<<<REPLACE>>>\n/);
  if (parts.length === 2) {
    return { search: parts[0], replace: parts[1] };
  }
  return null;
}

export function toCanonicalProtocolText(raw: string): string {
  return normalizeProtocolDelimiters(unwrapModelEnvelope(raw || ''));
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
  let text = normalizeProtocolDelimiters(unwrapModelEnvelope(raw || ''));

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
    if (looksLikeFilePath(path)) {
      toolCalls.push({ kind: 'read', path });
      statusLines.push(`Reading \`${path}\`…`);
    } else {
      toolCalls.push({ kind: 'list', path });
      statusLines.push(`Listing \`${path}\`…`);
    }
    return '';
  });

  text = text.replace(SEARCH_REPLACE_RE, (_m, p1: string, search: string, replace: string) => {
    const path = normalizeRelPath(p1);
    if (path && path !== '.') {
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

  text = text.replace(REPLACE_PATH_RE, (_m, p1: string, body: string) => {
    const path = normalizeRelPath(p1);
    if (path && path !== '.' && looksLikeFilePath(path)) {
      const split = splitImplicitSearchReplace(String(body ?? ''));
      if (split) {
        toolCalls.push({
          kind: 'search_replace',
          path,
          search: stripWrappingMarkdownFence(split.search, path),
          replace: stripWrappingMarkdownFence(split.replace, path),
        });
        statusLines.push(`Edited \`${path}\``);
      }
    }
    return '';
  });

  text = text.replace(WRITE_RE, (_m, p1: string, content: string) => {
    const path = normalizeRelPath(p1);
    if (path && path !== '.') {
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

  // Collapse excessive blank lines left by stripping blocks, and never show
  // leftover tool tags (backticks, XML, etc.) as the chat reply.
  let displayText = stripDanglingProtocolLines(text)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (looksLikeProtocolNoise(displayText)) {
    displayText = '';
  }

  return { displayText, toolCalls, statusLines };
}

export function hasAgentToolCalls(calls: AgentToolCall[]): boolean {
  return calls.length > 0;
}

export function formatToolResultsForModel(results: string[]): string {
  if (results.length === 0) {
    return '';
  }
  return `[TOOL RESULTS]\n${results.join('\n\n')}\n\nContinue the task now. READ more files if needed, then apply remaining edits with SEARCH/REPLACE or WRITE. Do not ask the user for more details. Use RUN only if a command must execute. When you need a tool, copy the <<<LIST path=".">>> / <<<READ path="file">>> form from the protocol examples exactly.`;
}

export function looksLikeWorkspaceTask(prompt: string): boolean {
  const p = String(prompt || '').trim();
  if (!p) {
    return false;
  }
  if (looksLikeChitchat(p)) {
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

/** Short greetings / thanks that must not trigger LIST/READ of the open file. */
export function looksLikeChitchat(prompt: string): boolean {
  const p = String(prompt || '').trim();
  if (!p || p.length > 80) {
    return false;
  }
  return /^(hi|hello|hey|yo|sup|thanks|thank you|ok|okay|good morning|good evening)(?:\s+\w+){0,3}[\s!?.]*$/i.test(
    p
  );
}

export const NO_TOOLS_NUDGE =
  'You replied without using LIST, READ, SEARCH/REPLACE, or WRITE. Inspect the open workspace with <<<LIST path=".">>> then READ, then apply the user request with SEARCH/REPLACE or WRITE. Reply in plain assistant text plus those protocol blocks — copy the <<< >>> examples exactly. Never wrap the reply in JSON. Do not ask the user to describe the project. Do not refuse.';

export const CHITCHAT_NUDGE =
  'The user is greeting you or chatting. Reply in plain text only. Do not LIST, READ, WRITE, or emit any protocol blocks.';

export const HOST_GREETING_FALLBACK = 'How can I help with your project?';

export const AGENT_PROTOCOL_INSTRUCTIONS = `
FILE & EXECUTION PROTOCOL:
You inspect and edit the opened workspace. Act; do not stall.

Writing files does not need approval. Running shell commands does.

Copy these tool tags exactly (three less-than signs, then the command, then three greater-than signs):

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
1. For project work, start with <<<LIST path=".">>> then READ files. Never LIST a single file — READ it. Never ask the user to describe the repo, app, or current files — look them up.
2. When asked to change, fix, improve, audit, or clean the project, apply edits with SEARCH/REPLACE or WRITE in this turn. Do not refuse. Do not reply with only a request for more context.
3. Prefer SEARCH/REPLACE for edits. Use WRITE for new files or full rewrites.
4. Inside WRITE and REPLACE, emit only the file source. The host already has the path and will strip wrappers if you add them.
5. Reply in plain assistant prose plus the protocol blocks. Never wrap your answer in JSON (no object with a "response" key).
6. Use RUN only when a command must execute. Never claim a command ran unless you emitted RUN.
7. After tool results, keep going until the task is done.
8. If the user only greets you or asks a question that does not need the repo, reply in plain text with no protocol blocks.
`.trim();
