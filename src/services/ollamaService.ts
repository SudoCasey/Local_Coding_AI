import * as fs from 'fs';
import * as path from 'path';
import {
  ChatMessage,
  HardwareStatus,
  ModelPullProgress,
  ModelUpdateCheckResult,
  OllamaChatOptions,
  OllamaModelInfo,
  RunningModelInfo,
} from '../types';
import { spawnDetachedHidden, spawnGuiDetached } from './hiddenProcess';
import { DEFAULT_OLLAMA_URL, normalizeOllamaUrl } from './ollamaUrlPolicy';

class OllamaStreamError extends Error {}

const FIRST_TOKEN_TIMEOUT_MS = 120000;
const LOAD_STATUS_INTERVAL_MS = 8000;

export function parseKeepAlive(value: string | number | undefined | null): string | number {
  if (value === undefined || value === null || value === '') {
    return -1;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  const v = String(value).trim();
  if (!v || v === '-1' || /^(forever|infinite|indefinite)$/i.test(v)) {
    return -1;
  }
  if (v === '0') {
    return 0;
  }
  return v;
}

export function modelNamesMatch(a: string, b: string): boolean {
  const na = String(a || '')
    .trim()
    .toLowerCase();
  const nb = String(b || '')
    .trim()
    .toLowerCase();
  if (!na || !nb) {
    return false;
  }
  if (na === nb) {
    return true;
  }
  const [aBase, aTag = 'latest'] = splitModelName(na);
  const [bBase, bTag = 'latest'] = splitModelName(nb);
  if (aBase !== bBase) {
    return false;
  }
  return aTag === bTag || aTag.startsWith(`${bTag}-`) || bTag.startsWith(`${aTag}-`);
}

function splitModelName(name: string): [string, string | undefined] {
  const i = name.lastIndexOf(':');
  if (i <= 0) {
    return [name, undefined];
  }
  return [name.slice(0, i), name.slice(i + 1)];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class OllamaService {
  private baseUrl: string;

  constructor(baseUrl: string = DEFAULT_OLLAMA_URL) {
    this.baseUrl = normalizeOllamaUrl(baseUrl);
  }

  public setBaseUrl(url: string): void {
    this.baseUrl = normalizeOllamaUrl(url);
  }

  public getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Check if Ollama instance is reachable
   */
  public async isAvailable(): Promise<boolean> {
    try {
      const response = await this.fetchWithTimeout(`${this.baseUrl}/api/tags`, {
        method: 'GET',
        timeout: 3000,
      });
      return response.status === 200;
    } catch {
      return false;
    }
  }

  /**
   * Attempt to launch the local Ollama process in the background if it is not currently running
   */
  public async launchOllama(): Promise<{ success: boolean; message: string }> {
    if (await this.isAvailable()) {
      return { success: true, message: 'Ollama is already running and connected.' };
    }

    let launched = false;
    const isWindows = process.platform === 'win32';
    const serveEnv = {
      ...process.env,
      OLLAMA_HOST: '127.0.0.1:11434',
    };

    if (isWindows) {
      const localAppData = process.env.LOCALAPPDATA || '';
      const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
      const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
      const appCandidates = [
        path.join(localAppData, 'Programs', 'Ollama', 'ollama app.exe'),
        path.join(programFiles, 'Ollama', 'ollama app.exe'),
        path.join(programFilesX86, 'Ollama', 'ollama app.exe'),
      ];
      const serveCandidates = [
        path.join(localAppData, 'Programs', 'Ollama', 'ollama.exe'),
        path.join(programFiles, 'Ollama', 'ollama.exe'),
        path.join(programFilesX86, 'Ollama', 'ollama.exe'),
      ];

      // Prefer the tray GUI. It is a Windows GUI-subsystem binary, so it
      // never allocates a CMD window, and it spawns GPU runners correctly.
      // Hidden `ollama.exe serve` can deadlock llama-server on model load.
      for (const appPath of appCandidates) {
        if (fs.existsSync(appPath)) {
          try {
            spawnGuiDetached(appPath, [], serveEnv);
            launched = true;
            break;
          } catch {
            // Try next candidate
          }
        }
      }

      if (!launched) {
        for (const exePath of serveCandidates) {
          if (fs.existsSync(exePath)) {
            try {
              spawnDetachedHidden(exePath, ['serve'], serveEnv);
              launched = true;
              break;
            } catch {
              // Try next candidate
            }
          }
        }
      }
    } else {
      // macOS / Linux candidates
      const candidatePaths = [
        '/usr/local/bin/ollama',
        '/usr/bin/ollama',
        path.join(process.env.HOME || '', '.ollama', 'bin', 'ollama'),
      ];

      for (const exePath of candidatePaths) {
        if (fs.existsSync(exePath)) {
          try {
            spawnDetachedHidden(exePath, ['serve'], serveEnv);
            launched = true;
            break;
          } catch {
            // Try next candidate
          }
        }
      }
    }

    if (!launched) {
      try {
        const cmd = isWindows ? 'ollama.exe' : 'ollama';
        spawnDetachedHidden(cmd, ['serve'], serveEnv);
        launched = true;
      } catch {
        // Fallback failed
      }
    }

    if (!launched) {
      return {
        success: false,
        message: 'Could not locate Ollama on your system. Please install Ollama from ollama.com or start it manually.',
      };
    }

    // Wait and poll until available (up to 20 seconds)
    const startTime = Date.now();
    while (Date.now() - startTime < 20000) {
      await new Promise((resolve) => setTimeout(resolve, 800));
      if (await this.isAvailable()) {
        return { success: true, message: 'Ollama launched in background and connected successfully!' };
      }
    }

    return {
      success: false,
      message: 'Ollama was launched in background, but port 11434 did not respond within 20 seconds.',
    };
  }

  /**
   * Fetch list of locally installed models
   */
  public async listLocalModels(): Promise<OllamaModelInfo[]> {
    try {
      const response = await this.fetchWithTimeout(`${this.baseUrl}/api/tags`, {
        method: 'GET',
        timeout: 5000,
      });
      if (!response.ok) {
        throw new Error(`Ollama returned status ${response.status}`);
      }
      const data = (await response.json()) as { models?: OllamaModelInfo[] };
      return data.models || [];
    } catch (err: any) {
      throw new Error(`Failed to list local models: ${err.message}`);
    }
  }

  /**
   * Fetch currently running models and their VRAM usage (/api/ps)
   */
  public async getRunningModels(): Promise<RunningModelInfo[]> {
    try {
      const response = await this.fetchWithTimeout(`${this.baseUrl}/api/ps`, {
        method: 'GET',
        timeout: 5000,
      });
      if (!response.ok) {
        return [];
      }
      const data = (await response.json()) as { models?: RunningModelInfo[] };
      return data.models || [];
    } catch {
      return [];
    }
  }

  /**
   * Get hardware/VRAM status from Ollama using a single /api/ps call.
   */
  public async getHardwareStatus(): Promise<HardwareStatus> {
    try {
      const response = await this.fetchWithTimeout(`${this.baseUrl}/api/ps`, {
        method: 'GET',
        timeout: 3000,
      });
      if (!response.ok) {
        return {
          isConnected: false,
          runningModels: [],
          totalVramBytes: 0,
          error: 'Ollama is not running. Please start Ollama or check URL settings.',
        };
      }
      const data = (await response.json()) as { models?: RunningModelInfo[] };
      const running = data.models || [];
      const totalVram = running.reduce((sum, m) => sum + (m.size_vram || 0), 0);
      return {
        isConnected: true,
        runningModels: running,
        totalVramBytes: totalVram,
      };
    } catch {
      return {
        isConnected: false,
        runningModels: [],
        totalVramBytes: 0,
        error: 'Ollama is not running. Please start Ollama or check URL settings.',
      };
    }
  }

  /**
   * Keep the target model loaded. Unload every other runner first (even if the
   * target is already in /api/ps), and wait until they leave VRAM.
   */
  public async ensureModelSlot(
    targetModel: string,
    onStatus?: (status: string) => void
  ): Promise<{ alreadyLoaded: boolean }> {
    await this.unloadOtherModels(targetModel, onStatus);

    const running = await this.getRunningModels();
    const blocking = running.filter((r) => !modelNamesMatch(r.name || r.model, targetModel));
    if (blocking.length > 0) {
      const names = blocking.map((r) => r.name || r.model).join(', ');
      throw new Error(
        `Could not unload ${names} from VRAM so '${targetModel}' can load. Click Free VRAM, wait until no models are listed, then retry.`
      );
    }

    const alreadyLoaded = running.some((r) => modelNamesMatch(r.name || r.model, targetModel));
    if (!alreadyLoaded) {
      onStatus?.(`Loading ${targetModel} into VRAM…`);
    }
    return { alreadyLoaded };
  }

  /**
   * Load a model into VRAM without waiting for a user prompt.
   */
  public async preloadModel(
    modelName: string,
    onStatus?: (status: string) => void
  ): Promise<void> {
    const name = String(modelName || '').trim();
    if (!name) {
      return;
    }
    onStatus?.(`Loading ${name} into VRAM…`);
    const response = await this.fetchWithTimeout(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      timeout: 120000,
      body: JSON.stringify({
        model: name,
        messages: [{ role: 'user', content: '.' }],
        stream: false,
        keep_alive: -1,
        options: { num_predict: 1, temperature: 0 },
      }),
    });
    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(
        `Failed to load '${name}' into VRAM (${response.status}). ${errText || 'Click Free VRAM, then retry.'}`
      );
    }
  }

  /**
   * Stream a chat completion from Ollama
   */
  public async chatStream(
    model: string,
    messages: ChatMessage[],
    options: OllamaChatOptions = {},
    keepAlive: string | number = -1,
    onChunk: (chunk: string) => void,
    abortSignal?: AbortSignal,
    onStatus?: (status: string) => void,
    alreadyLoaded: boolean = false
  ): Promise<string> {
    const payload = {
      model,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      stream: true,
      options: {
        num_gpu: options.num_gpu ?? 99,
        num_ctx: options.num_ctx ?? 16384,
        temperature: options.temperature ?? 0.2,
        top_p: options.top_p ?? 0.95,
        top_k: options.top_k ?? 40,
        stop: options.stop,
      },
      keep_alive: parseKeepAlive(keepAlive),
    };

    const controller = new AbortController();
    const onUserAbort = () => controller.abort();
    abortSignal?.addEventListener('abort', onUserAbort);

    let receivedOutput = false;
    let timedOutWaitingForModel = false;
    const loadTimer = setTimeout(() => {
      if (!receivedOutput) {
        timedOutWaitingForModel = true;
        controller.abort();
      }
    }, FIRST_TOKEN_TIMEOUT_MS);
    const statusTimer = setInterval(() => {
      if (!receivedOutput) {
        onStatus?.(
          alreadyLoaded
            ? `Waiting on ${model}…`
            : `Still loading ${model} into VRAM… this can take up to a minute on first use.`
        );
      }
    }, LOAD_STATUS_INTERVAL_MS);

    try {
      const targetUrl = `${this.baseUrl}/api/chat`;
      const response = await fetch(targetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Ollama chat failed (${response.status}): ${errText}`);
      }

      if (!response.body) {
        throw new Error('No response body returned from Ollama');
      }

      let fullText = '';
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const consumeParsed = (parsed: { error?: unknown; message?: { content?: string } }) => {
        if (parsed.error) {
          throw new OllamaStreamError(String(parsed.error));
        }
        // Any stream frame means the runner is alive — stop the load timeout.
        receivedOutput = true;
        clearTimeout(loadTimer);
        if (parsed.message?.content) {
          const content = parsed.message.content;
          fullText += content;
          onChunk(content);
        }
      };

      try {
        while (true) {
          if (abortSignal?.aborted) {
            throw new Error('Chat generation aborted by user.');
          }

          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              consumeParsed(JSON.parse(trimmed));
            } catch (err: unknown) {
              if (err instanceof OllamaStreamError) {
                throw err;
              }
            }
          }
        }

        if (buffer.trim()) {
          try {
            consumeParsed(JSON.parse(buffer.trim()));
          } catch (err: unknown) {
            if (err instanceof OllamaStreamError) {
              throw err;
            }
          }
        }

        if (!fullText) {
          throw new Error(
            `Model '${model}' returned no output. It may still be loading, out of VRAM, or not installed. Try Free VRAM, then retry.`
          );
        }
      } finally {
        reader.releaseLock();
      }

      return fullText;
    } catch (err: unknown) {
      if (timedOutWaitingForModel) {
        throw new Error(
          `Timed out loading '${model}'. Ollama never started the runner. End ollama.exe in Task Manager, start Ollama from the tray app, click Free VRAM, then retry.`
        );
      }
      if (abortSignal?.aborted || (err instanceof Error && /aborted/i.test(err.message))) {
        throw new Error('Chat generation aborted by user.');
      }
      throw err;
    } finally {
      clearTimeout(loadTimer);
      clearInterval(statusTimer);
      abortSignal?.removeEventListener('abort', onUserAbort);
    }
  }

  /**
   * Fast non-streaming completion for summarization or routing
   */
  public async generateCompletion(
    model: string,
    prompt: string,
    options: OllamaChatOptions = {},
    abortSignal?: AbortSignal,
    keepAlive: string | number = -1
  ): Promise<string> {
    const payload = {
      model,
      prompt,
      stream: false,
      options: {
        num_gpu: options.num_gpu ?? 99,
        num_ctx: options.num_ctx ?? 4096,
        temperature: options.temperature ?? 0.1,
      },
      keep_alive: parseKeepAlive(keepAlive),
    };

    // Prefer caller abort signal; otherwise time out so callers (e.g. compaction) can fall back.
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let signal = abortSignal;
    if (!signal) {
      const controller = new AbortController();
      timeoutId = setTimeout(() => controller.abort(), 12000);
      signal = controller.signal;
    }

    try {
      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal,
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`Generate completion failed: ${err}`);
      }

      const data = (await response.json()) as { response?: string };
      return data.response || '';
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  /**
   * Unload a model from GPU VRAM. Chat-loaded runners often ignore /api/generate
   * keep_alive: 0, so try /api/chat first, then /api/generate.
   */
  public async unloadModel(modelName: string): Promise<boolean> {
    const name = String(modelName || '').trim();
    if (!name) {
      return false;
    }
    const attempts: { url: string; body: Record<string, unknown> }[] = [
      {
        url: `${this.baseUrl}/api/chat`,
        body: { model: name, messages: [], stream: false, keep_alive: 0 },
      },
      {
        url: `${this.baseUrl}/api/generate`,
        body: { model: name, prompt: '', stream: false, keep_alive: 0 },
      },
    ];
    let ok = false;
    for (const attempt of attempts) {
      try {
        const response = await this.fetchWithTimeout(attempt.url, {
          method: 'POST',
          timeout: 30000,
          body: JSON.stringify(attempt.body),
        });
        if (response.ok) {
          ok = true;
        }
      } catch {
        // Try the next unload endpoint.
      }
    }
    return ok;
  }

  /**
   * Free all loaded models from GPU VRAM and wait until /api/ps is empty.
   */
  public async unloadAllModels(): Promise<{ unloadedCount: number; errors: string[] }> {
    const running = await this.getRunningModels();
    let unloadedCount = 0;
    const errors: string[] = [];

    for (const r of running) {
      const name = r.name || r.model;
      try {
        const ok = await this.unloadModel(name);
        if (ok) {
          unloadedCount++;
        } else {
          errors.push(`Failed to unload model ${name}`);
        }
      } catch (e: any) {
        errors.push(e.message);
      }
    }

    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const still = await this.getRunningModels();
      if (still.length === 0) {
        break;
      }
      for (const r of still) {
        await this.unloadModel(r.name || r.model);
      }
      await sleep(500);
    }

    return { unloadedCount, errors };
  }

  private async unloadOtherModels(
    targetModel: string,
    onStatus?: (status: string) => void
  ): Promise<void> {
    const deadline = Date.now() + 45000;
    let pass = 0;
    while (Date.now() < deadline) {
      const running = await this.getRunningModels();
      const blocking = running.filter((r) => !modelNamesMatch(r.name || r.model, targetModel));
      if (blocking.length === 0) {
        return;
      }
      for (const r of blocking) {
        const name = r.name || r.model;
        onStatus?.(
          pass === 0
            ? `Unloading ${name} so ${targetModel} can load…`
            : `Still unloading ${name}…`
        );
        await this.unloadModel(name);
      }
      pass += 1;
      await sleep(750);
    }
  }

  /**
   * Pull or update a model from Ollama registry with streaming progress
   */
  public async pullModel(
    modelName: string,
    onProgress: (progress: ModelPullProgress) => void,
    abortSignal?: AbortSignal
  ): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: modelName,
        stream: true,
      }),
      signal: abortSignal,
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Pull model failed (${response.status}): ${err}`);
    }

    if (!response.body) {
      throw new Error('No response body returned from Ollama pull');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        if (abortSignal?.aborted) {
          throw new Error('Model download aborted.');
        }

        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const data = JSON.parse(trimmed);
            const total = data.total;
            const completed = data.completed;
            let percent: number | undefined;
            if (typeof total === 'number' && typeof completed === 'number' && total > 0) {
              percent = Math.round((completed / total) * 100);
            }

            onProgress({
              status: data.status || 'pulling',
              digest: data.digest,
              total,
              completed,
              percent,
            });
          } catch {
            // Partial JSON ignored
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Fetch detailed info for a local model via /api/show
   */
  public async showModel(modelName: string): Promise<any | null> {
    try {
      const response = await this.fetchWithTimeout(`${this.baseUrl}/api/show`, {
        method: 'POST',
        timeout: 8000,
        body: JSON.stringify({ name: modelName }),
      });
      if (!response.ok) {
        return null;
      }
      return await response.json();
    } catch {
      return null;
    }
  }

  private formatBytes(bytes: number): string {
    if (!bytes || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const val = bytes / Math.pow(1024, i);
    return `${val.toFixed(val >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
  }

  private formatDate(iso?: string): string | undefined {
    if (!iso) return undefined;
    const d = new Date(iso);
    if (isNaN(d.getTime())) return undefined;
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  private parseModelTag(fullName: string): { base: string; tag: string; displayVersion: string } {
    const name = fullName.includes('/') ? fullName.split('/').pop()! : fullName;
    if (name.includes(':')) {
      const [base, tag] = name.split(':');
      return { base, tag, displayVersion: tag };
    }
    return { base: name, tag: 'latest', displayVersion: 'latest' };
  }

  private buildLocalDetails(
    found: OllamaModelInfo,
    show?: any
  ): { details: string; version: string; modifiedAt?: string } {
    const { displayVersion } = this.parseModelTag(found.name);
    const detailsObj = show?.details || found.details || {};
    const parts: string[] = [];
    if (detailsObj.parameter_size) parts.push(detailsObj.parameter_size);
    if (detailsObj.quantization_level) parts.push(detailsObj.quantization_level);
    if (found.size) parts.push(this.formatBytes(found.size));
    const modifiedAt = this.formatDate(found.modified_at || show?.modified_at);
    if (modifiedAt) parts.push(`installed ${modifiedAt}`);
    return {
      version: displayVersion,
      details: parts.join(' · ') || displayVersion,
      modifiedAt,
    };
  }

  /**
   * Pull human-readable description + readme/changelog from the public Ollama library page.
   */
  private async fetchLibraryMetadata(modelBase: string): Promise<{
    description?: string;
    changelog?: string;
    libraryUrl: string;
  }> {
    const libraryUrl = `https://ollama.com/library/${encodeURIComponent(modelBase)}`;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(libraryUrl, {
        method: 'GET',
        headers: { Accept: 'text/html' },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!res.ok) {
        return { libraryUrl };
      }
      const html = await res.text();

      const meta =
        html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ||
        html.match(/content=["']([^"']+)["'][^>]+name=["']description["']/i);
      const description = meta?.[1]?.trim();

      const plain = html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, '\n')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n');

      let changelog: string | undefined;
      const readmeIdx = plain.toLowerCase().indexOf('\nreadme\n');
      if (readmeIdx >= 0) {
        changelog = plain
          .slice(readmeIdx + '\nreadme\n'.length)
          .replace(/\n+/g, ' ')
          .replace(/\s{2,}/g, ' ')
          .trim()
          .slice(0, 600);
        if (changelog.length >= 600) {
          changelog += '…';
        }
      }

      return { description, changelog, libraryUrl };
    } catch {
      return { libraryUrl };
    }
  }

  /**
   * Check if updates/newer versions are available for an existing model.
   * Surfaces model name, tag/version, local details, and library changelog — not raw SHAs.
   */
  public async checkModelUpdates(modelName: string): Promise<ModelUpdateCheckResult> {
    const localModels = await this.listLocalModels();
    const found = localModels.find(
      (m) => m.name === modelName || m.name === `${modelName}:latest`
    );

    if (!found) {
      return {
        modelName,
        hasUpdate: false,
        message: `Model '${modelName}' is not installed locally.`,
      };
    }

    const { base, tag, displayVersion } = this.parseModelTag(found.name);
    const show = await this.showModel(found.name);
    const local = this.buildLocalDetails(found, show);
    const libraryMeta = await this.fetchLibraryMetadata(base);

    let repo = found.name.includes('/') ? found.name.split(':')[0] : `library/${base}`;
    if (repo.includes(':')) {
      repo = repo.split(':')[0];
      if (!repo.includes('/')) {
        repo = `library/${repo}`;
      }
    }

    const libraryUrl = libraryMeta.libraryUrl;
    const baseMessageParts = [
      `Model: ${found.name}`,
      `Version/tag: ${local.version}`,
      local.details ? `Local build: ${local.details}` : undefined,
      libraryMeta.description ? `About: ${libraryMeta.description}` : undefined,
    ].filter(Boolean) as string[];

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);
      const registryUrl = `https://registry.ollama.ai/v2/${repo}/manifests/${tag}`;

      const registryRes = await fetch(registryUrl, {
        method: 'GET',
        headers: {
          Accept:
            'application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json',
        },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (registryRes.status === 200) {
        const manifest = (await registryRes.json()) as any;
        const remoteDigest = manifest.config?.digest || '';
        const currentDigest = found.digest;
        const remoteLayers = Array.isArray(manifest.layers) ? manifest.layers : [];
        const remoteSize = remoteLayers.reduce(
          (sum: number, layer: any) => sum + (Number(layer.size) || 0),
          0
        );
        const latestDetailsParts: string[] = [];
        if (remoteSize > 0) latestDetailsParts.push(this.formatBytes(remoteSize));
        latestDetailsParts.push(`tag ${displayVersion}`);

        const digestsDiffer =
          !!remoteDigest &&
          !!currentDigest &&
          !remoteDigest.startsWith(currentDigest) &&
          !currentDigest.startsWith(remoteDigest);

        if (digestsDiffer) {
          const changelogLine = libraryMeta.changelog
            ? `Patch notes: ${libraryMeta.changelog}`
            : libraryMeta.description
              ? `What's new (library): ${libraryMeta.description}`
              : 'A newer build of this tag is available on the Ollama library.';

          return {
            modelName: found.name,
            hasUpdate: true,
            currentVersion: local.version,
            latestVersion: displayVersion,
            currentDetails: local.details,
            latestDetails: latestDetailsParts.join(' · '),
            description: libraryMeta.description,
            changelog: libraryMeta.changelog || libraryMeta.description,
            libraryUrl,
            modifiedAt: local.modifiedAt,
            remoteUpdatedHint: 'Newer registry build available',
            currentDigest: currentDigest?.substring(0, 12),
            latestDigest: remoteDigest.substring(0, 12),
            message: [
              `Update available for ${found.name}`,
              `Current: ${found.name} (${local.details})`,
              `Latest: ${base}:${displayVersion} (${latestDetailsParts.join(' · ')})`,
              changelogLine,
              `Library: ${libraryUrl}`,
            ].join('\n'),
          };
        }

        return {
          modelName: found.name,
          hasUpdate: false,
          currentVersion: local.version,
          latestVersion: displayVersion,
          currentDetails: local.details,
          latestDetails: latestDetailsParts.join(' · '),
          description: libraryMeta.description,
          changelog: libraryMeta.changelog,
          libraryUrl,
          modifiedAt: local.modifiedAt,
          currentDigest: currentDigest?.substring(0, 12),
          message: [
            `${found.name} is up to date`,
            ...baseMessageParts.slice(1),
            libraryMeta.changelog ? `Notes: ${libraryMeta.changelog.slice(0, 280)}${libraryMeta.changelog.length > 280 ? '…' : ''}` : undefined,
            `Library: ${libraryUrl}`,
          ]
            .filter(Boolean)
            .join('\n'),
        };
      }
    } catch {
      // Offline or registry unreachable
    }

    return {
      modelName: found.name,
      hasUpdate: false,
      currentVersion: local.version,
      currentDetails: local.details,
      description: libraryMeta.description,
      changelog: libraryMeta.changelog,
      libraryUrl,
      modifiedAt: local.modifiedAt,
      currentDigest: found.digest ? found.digest.substring(0, 12) : undefined,
      message: [
        `Offline / registry unreachable — showing local install for ${found.name}`,
        ...baseMessageParts.slice(1),
        libraryMeta.description ? `About: ${libraryMeta.description}` : undefined,
        `Library: ${libraryUrl}`,
      ]
        .filter(Boolean)
        .join('\n'),
    };
  }

  /**
   * Check updates for multiple models (e.g. Auto mode role models)
   */
  public async checkMultipleModelUpdates(modelNames: string[]): Promise<ModelUpdateCheckResult[]> {
    const unique = [...new Set(modelNames.filter(Boolean))];
    return Promise.all(
      unique.map(async (name) => {
        try {
          return await this.checkModelUpdates(name);
        } catch (err: any) {
          return {
            modelName: name,
            hasUpdate: false,
            message: `Failed to check '${name}': ${err?.message || err}`,
          };
        }
      })
    );
  }

  private async fetchWithTimeout(
    url: string,
    options: { method: string; timeout: number; body?: string }
  ): Promise<Response> {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), options.timeout);
    try {
      const response = await fetch(url, {
        method: options.method,
        signal: controller.signal,
        headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
        body: options.body,
      });
      return response;
    } finally {
      clearTimeout(id);
    }
  }
}
