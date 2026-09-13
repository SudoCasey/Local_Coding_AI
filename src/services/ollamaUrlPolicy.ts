export const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';

export const MIN_CONTEXT_WINDOW = 512;
export const MAX_CONTEXT_WINDOW = 1048576;

export function normalizeOllamaUrl(url: string): string {
  const trimmed = (url || DEFAULT_OLLAMA_URL).trim();
  return trimmed.replace(/\/+$/, '') || DEFAULT_OLLAMA_URL;
}

/**
 * True only for loopback HTTP(S) hosts. Remote and LAN addresses require
 * explicit user confirmation before prompts are sent there.
 */
export function isLoopbackOllamaUrl(url: string): boolean {
  try {
    const parsed = new URL(normalizeOllamaUrl(url));
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
    const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}

export function clampContextWindow(value: number, fallback: number = 16384): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(MAX_CONTEXT_WINDOW, Math.max(MIN_CONTEXT_WINDOW, Math.floor(value)));
}
