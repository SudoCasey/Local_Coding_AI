import { spawn } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as path from 'path';
import { URL } from 'url';
import {
  ChatMessage,
  HardwareStatus,
  ModelPullProgress,
  ModelUpdateCheckResult,
  OllamaChatOptions,
  OllamaModelInfo,
  RunningModelInfo,
} from '../types';

export class OllamaService {
  private baseUrl: string;

  constructor(baseUrl: string = 'http://127.0.0.1:11434') {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  public setBaseUrl(url: string): void {
    this.baseUrl = url.replace(/\/+$/, '');
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

    if (isWindows) {
      const localAppData = process.env.LOCALAPPDATA || '';
      const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
      const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
      const candidatePaths = [
        path.join(localAppData, 'Programs', 'Ollama', 'ollama.exe'),
        path.join(programFiles, 'Ollama', 'ollama.exe'),
        path.join(programFilesX86, 'Ollama', 'ollama.exe'),
      ];

      for (const exePath of candidatePaths) {
        if (fs.existsSync(exePath)) {
          try {
            // Launch pure headless daemon in background with windowsHide
            const child = spawn(exePath, ['serve'], {
              detached: true,
              stdio: 'ignore',
              windowsHide: true,
              env: { ...process.env, OLLAMA_HOST: '127.0.0.1:11434' },
            });
            child.unref();
            launched = true;
            break;
          } catch {
            // Try next candidate
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
            const child = spawn(exePath, ['serve'], {
              detached: true,
              stdio: 'ignore',
              env: { ...process.env, OLLAMA_HOST: '127.0.0.1:11434' },
            });
            child.unref();
            launched = true;
            break;
          } catch {
            // Try next candidate
          }
        }
      }
    }

    if (!launched) {
      // Fallback: Attempt starting via command line 'ollama.exe serve' or 'ollama serve'
      try {
        const cmd = isWindows ? 'ollama.exe' : 'ollama';
        const child = spawn(cmd, ['serve'], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
          env: { ...process.env, OLLAMA_HOST: '127.0.0.1:11434' },
        });
        child.unref();
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
   * Get hardware/VRAM status from Ollama
   */
  public async getHardwareStatus(): Promise<HardwareStatus> {
    const isConn = await this.isAvailable();
    if (!isConn) {
      return {
        isConnected: false,
        runningModels: [],
        totalVramBytes: 0,
        error: 'Ollama is not running. Please start Ollama or check URL settings.',
      };
    }

    const running = await this.getRunningModels();
    const totalVram = running.reduce((sum, m) => sum + (m.size_vram || 0), 0);

    return {
      isConnected: true,
      runningModels: running,
      totalVramBytes: totalVram,
    };
  }

  /**
   * Stream a chat completion from Ollama
   */
  public async chatStream(
    model: string,
    messages: ChatMessage[],
    options: OllamaChatOptions = {},
    keepAlive: string = '10m',
    onChunk: (chunk: string) => void,
    abortSignal?: AbortSignal
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
      keep_alive: keepAlive,
    };

    const targetUrl = `${this.baseUrl}/api/chat`;
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: abortSignal,
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
            const parsed = JSON.parse(trimmed);
            if (parsed.message?.content) {
              const content = parsed.message.content;
              fullText += content;
              onChunk(content);
            }
          } catch {
            // Partial JSON ignored until next chunk
          }
        }
      }

      if (buffer.trim()) {
        try {
          const parsed = JSON.parse(buffer.trim());
          if (parsed.message?.content) {
            fullText += parsed.message.content;
            onChunk(parsed.message.content);
          }
        } catch {}
      }
    } finally {
      reader.releaseLock();
    }

    return fullText;
  }

  /**
   * Fast non-streaming completion for summarization or routing
   */
  public async generateCompletion(
    model: string,
    prompt: string,
    options: OllamaChatOptions = {},
    abortSignal?: AbortSignal
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
      keep_alive: '5m',
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
   * Unload a specific model from GPU VRAM immediately by setting keep_alive: 0
   */
  public async unloadModel(modelName: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelName,
          keep_alive: 0,
        }),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Free all loaded models from GPU VRAM
   */
  public async unloadAllModels(): Promise<{ unloadedCount: number; errors: string[] }> {
    const running = await this.getRunningModels();
    let unloadedCount = 0;
    const errors: string[] = [];

    for (const r of running) {
      try {
        const ok = await this.unloadModel(r.name || r.model);
        if (ok) {
          unloadedCount++;
        } else {
          errors.push(`Failed to unload model ${r.name}`);
        }
      } catch (e: any) {
        errors.push(e.message);
      }
    }

    return { unloadedCount, errors };
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
    const results: ModelUpdateCheckResult[] = [];
    for (const name of unique) {
      try {
        results.push(await this.checkModelUpdates(name));
      } catch (err: any) {
        results.push({
          modelName: name,
          hasUpdate: false,
          message: `Failed to check '${name}': ${err?.message || err}`,
        });
      }
    }
    return results;
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
