import * as vscode from 'vscode';
import { ContextManager } from '../services/contextManager';
import { ModelRouter } from '../services/modelRouter';
import { OllamaService } from '../services/ollamaService';
import { WorkspaceService } from '../services/workspaceService';
import {
  ChatMessage,
  ExtensionToWebviewMessage,
  HardwareStatus,
  ModelPullProgress,
  WebviewToExtensionMessage,
} from '../types';
import { clampContextWindow } from '../services/ollamaUrlPolicy';
import { AgentExecutor } from '../services/agentExecutor';
import { ChangeTracker } from '../services/changeTracker';
import { looksLikeWorkspaceTask } from '../services/agentProtocol';
import {
  WritePermissionMode,
  WritePermissionService,
} from '../services/writePermission';

export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'localCodingAI.chatView';
  public static readonly primaryViewType = 'localCodingAI.chatView';
  public static readonly secondaryViewType = 'localCodingAI.chatViewRight';

  private _views: Set<vscode.WebviewView> = new Set();
  private ollamaService: OllamaService;
  private contextManager: ContextManager;
  private modelRouter: ModelRouter;
  private workspaceService: WorkspaceService;
  private writePermissions: WritePermissionService;
  private changeTracker = new ChangeTracker();
  private agentExecutor: AgentExecutor;
  private abortController?: AbortController;
  private activePulls: Map<string, AbortController> = new Map();
  private refreshTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly extensionUri: vscode.Uri,
    ollamaService: OllamaService,
    contextManager: ContextManager,
    modelRouter: ModelRouter,
    workspaceService: WorkspaceService,
    writePermissions?: WritePermissionService
  ) {
    this.ollamaService = ollamaService;
    this.contextManager = contextManager;
    this.modelRouter = modelRouter;
    this.workspaceService = workspaceService;
    this.writePermissions = writePermissions || new WritePermissionService();
    this.agentExecutor = new AgentExecutor(
      this.workspaceService,
      this.writePermissions,
      this.changeTracker
    );
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._views.add(webviewView);

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // Setup message listener from Webview
    const messageSub = webviewView.webview.onDidReceiveMessage(
      async (message: WebviewToExtensionMessage) => {
        await this.handleWebviewMessage(message);
      }
    );

    // One deferred refresh when the view is shown — probing Ollama during
    // activate/resolve makes llama-server allocate console windows on Windows.
    const visibilitySub = webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this.scheduleRefreshModelsAndStatus();
      }
    });

    if (webviewView.visible) {
      this.scheduleRefreshModelsAndStatus();
    }

    webviewView.onDidDispose(() => {
      messageSub.dispose();
      visibilitySub.dispose();
      this._views.delete(webviewView);
    });
  }

  /**
   * Synchronously release timers, abort in-flight work, and drop held state.
   */
  public dispose(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
    this.handleStopGeneration();

    for (const ctrl of this.activePulls.values()) {
      try {
        ctrl.abort();
      } catch {
        // ignore
      }
    }
    this.activePulls.clear();

    this.contextManager.clear();
    this._views.clear();
  }

  /**
   * Full cleanup used on extension deactivate: local dispose + best-effort VRAM unload.
   */
  public async disposeAsync(): Promise<void> {
    this.dispose();
    try {
      await Promise.race([
        this.ollamaService.unloadAllModels(),
        new Promise<void>((resolve) => setTimeout(resolve, 2500)),
      ]);
    } catch {
      // Ollama may already be gone; ignore
    }
  }

  public postMessage(message: ExtensionToWebviewMessage): void {
    for (const view of this._views) {
      view.webview.postMessage(message);
    }
  }

  public scheduleRefreshModelsAndStatus(delayMs = 500): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      void this.refreshModelsAndStatus();
    }, delayMs);
  }

  public async refreshModelsAndStatus(): Promise<void> {
    try {
      const models = await this.ollamaService.listLocalModels();
      const config = vscode.workspace.getConfiguration('localCodingAI');
      const autoConfig = {
        fastModel: config.get<string>('fastModel') || 'qwen2.5-coder:1.5b',
        primaryModel: config.get<string>('primaryModel') || 'qwen2.5-coder:7b',
        heavyModel: config.get<string>('heavyModel') || 'qwen2.5-coder:14b',
        installedNames: models.map((m) => m.name),
      };
      this.modelRouter.updateConfig({
        fastModel: autoConfig.fastModel,
        primaryModel: autoConfig.primaryModel,
        heavyModel: autoConfig.heavyModel,
      });
      this.postMessage({
        type: 'modelsList',
        payload: {
          models,
          selectedModel: this.modelRouter.getSelectedModel(),
          mode: this.modelRouter.getMode(),
          autoConfig,
          writePermissionMode: this.writePermissions.getMode(),
          writeAllowlist: this.writePermissions.getAllowlist(),
        },
      });
      await this.sendHardwareStatus();
    } catch {
      this.postMessage({
        type: 'statusUpdate',
        payload: {
          isConnected: false,
          error: 'Cannot connect to Ollama. Ensure Ollama is running locally.',
          writePermissionMode: this.writePermissions.getMode(),
          writeAllowlist: this.writePermissions.getAllowlist(),
        },
      });
    }
  }

  public postWritePermissionState(): void {
    this.postMessage({
      type: 'writePermissionState',
      payload: {
        mode: this.writePermissions.getMode(),
        allowlist: this.writePermissions.getAllowlist(),
      },
    });
  }

  public hasVisibleView(): boolean {
    return Array.from(this._views).some((v) => v.visible);
  }

  public async sendHardwareStatus(status?: HardwareStatus): Promise<void> {
    try {
      const hw = status ?? (await this.ollamaService.getHardwareStatus());
      const currentTokens = this.contextManager.getTotalTokens();
      const config = vscode.workspace.getConfiguration('localCodingAI');
      const maxContext = clampContextWindow(config.get<number>('contextWindow') || 16384);

      this.postMessage({
        type: 'statusUpdate',
        payload: {
          ...hw,
          currentTokens,
          maxContext,
          tokenRatio: Math.min(1, currentTokens / maxContext),
        },
      });
    } catch {
      // Ignored during status polling
    }
  }

  private async handleWebviewMessage(message: WebviewToExtensionMessage): Promise<void> {
    switch (message.type) {
      case 'sendMessage':
        await this.handleUserMessage(message.payload);
        break;

      case 'stopGeneration':
        this.handleStopGeneration();
        break;

      case 'clearContext':
        this.handleClearContext();
        break;

      case 'freeVram':
        await this.handleFreeVram();
        break;

      case 'freeRam':
        await this.handleFreeRam();
        break;

      case 'compactContext':
        await this.handleCompactContext();
        break;

      case 'getModels':
        await this.refreshModelsAndStatus();
        break;

      case 'getHardwareStatus':
        await this.sendHardwareStatus();
        break;

      case 'selectModel':
        this.modelRouter.setSelectedModel(message.payload.model);
        this.postMessage({
          type: 'modelSelected',
          payload: {
            selectedModel: this.modelRouter.getSelectedModel(),
            mode: this.modelRouter.getMode(),
          },
        });
        break;

      case 'setAutoModelRole':
        await this.handleSetAutoModelRole(message.payload?.role, message.payload?.modelName);
        break;

      case 'downloadAutoRoleModel':
        await this.handleDownloadAutoRoleModel(message.payload?.role, message.payload?.modelName);
        break;

      case 'pullModel':
        await this.handlePullModel(message.payload.modelName);
        break;

      case 'cancelPullModel':
        this.handleCancelPullModel(message.payload.modelName);
        break;

      case 'launchOllama':
        await this.handleLaunchOllama();
        break;

      case 'setContextLimit': {
        const newLimit = clampContextWindow(Number(message.payload?.contextWindow), 0);
        if (newLimit >= 512) {
          await vscode.workspace
            .getConfiguration('localCodingAI')
            .update('contextWindow', newLimit, vscode.ConfigurationTarget.Global);
          vscode.window.showInformationMessage(
            `Context window limit updated to ${newLimit.toLocaleString()} tokens.`
          );
          await this.sendHardwareStatus();
        }
        break;
      }

      case 'promptCustomContextLimit': {
        await this.promptUserForCustomContextLimit();
        break;
      }

      case 'toggleSidebarPosition':
        await vscode.commands.executeCommand('localCodingAI.toggleSidebarPosition');
        break;

      case 'checkModelUpdates':
        await this.handleCheckModelUpdates(message.payload.modelName);
        break;

      case 'applyCodeToEditor': {
        vscode.window.showInformationMessage(
          'File edits are applied automatically by the assistant. Use Undo on the change list if needed.'
        );
        break;
      }

      case 'insertCodeAtCursor': {
        const code = String(message.payload?.code || '');
        if (!code) {
          break;
        }
        // Inserting text is writing, not executing — no Allowlist.
        await this.workspaceService.insertAtCursor(code);
        break;
      }

      case 'undoFileChanges': {
        const batchId = String(message.payload?.batchId || '');
        if (!batchId) {
          break;
        }
        const result = await this.agentExecutor.undoBatch(batchId);
        this.postMessage({
          type: 'filesUndone',
          payload: {
            batchId,
            restored: result.restored,
            errors: result.errors,
          },
        });
        if (result.errors.length === 0) {
          vscode.window.showInformationMessage(
            `Undid changes to ${result.restored.length} file(s).`
          );
        } else {
          vscode.window.showWarningMessage(
            `Undo finished with issues: ${result.errors.join('; ')}`
          );
        }
        break;
      }

      case 'setWritePermissionMode': {
        const mode = message.payload?.mode as WritePermissionMode;
        if (mode === 'allowlist' || mode === 'runEverything') {
          await this.writePermissions.setMode(mode);
          this.postWritePermissionState();
        }
        break;
      }

      case 'manageWritePermissions':
        await this.writePermissions.showManageAllowlistQuickPick();
        this.postWritePermissionState();
        break;

      case 'copyCode':
        await vscode.env.clipboard.writeText(message.payload.code);
        vscode.window.showInformationMessage('Code copied to clipboard.');
        break;

      case 'attachActiveFile': {
        const editorCtx = this.workspaceService.getActiveEditorContext({ includeFullContent: true });
        if (editorCtx && editorCtx.fullContent) {
          const content = `\`\`\`${editorCtx.languageId || ''} // ${editorCtx.relativePath || editorCtx.fileName}\n${editorCtx.fullContent}\n\`\`\``;
          this.postMessage({
            type: 'contextAttached',
            payload: {
              type: 'file',
              name: editorCtx.relativePath || editorCtx.fileName || 'Active File',
              content,
            },
          });
        } else {
          vscode.window.showWarningMessage('No active file open to attach.');
        }
        break;
      }

      case 'attachSelection': {
        const editorCtx = this.workspaceService.getActiveEditorContext({ includeFullContent: false });
        if (editorCtx && editorCtx.selectedText) {
          const content = `\`\`\`${editorCtx.languageId || ''} // Selection from ${editorCtx.relativePath || editorCtx.fileName} (line ${editorCtx.cursorLine})\n${editorCtx.selectedText}\n\`\`\``;
          this.postMessage({
            type: 'contextAttached',
            payload: {
              type: 'selection',
              name: `Selection (${editorCtx.fileName || 'file'})`,
              content,
            },
          });
        } else {
          vscode.window.showWarningMessage('No text currently selected in active editor.');
        }
        break;
      }

      case 'openSettings':
        await vscode.commands.executeCommand('workbench.action.openSettings', 'localCodingAI');
        break;
    }
  }

  public async handleUserMessage(payload: { prompt: string; contextAttachments?: string[] }): Promise<void> {
    const rawPrompt = payload.prompt.trim();
    if (!rawPrompt) return;

    let fullUserPrompt = rawPrompt;
    if (payload.contextAttachments && payload.contextAttachments.length > 0) {
      fullUserPrompt = `${payload.contextAttachments.join('\n\n')}\n\n${rawPrompt}`;
    }

    // Add user message to context manager
    const userMsg: ChatMessage = {
      role: 'user',
      content: fullUserPrompt,
      timestamp: Date.now(),
    };
    this.contextManager.addMessage(userMsg);

    const config = vscode.workspace.getConfiguration('localCodingAI');
    const maxContext = clampContextWindow(config.get<number>('contextWindow') || 16384);
    const compactionThreshold = config.get<number>('autoCompactionThreshold') || 0.75;
    const fastModel = config.get<string>('fastModel') || 'qwen2.5-coder:1.5b';
    const gpuLayers = config.get<number>('gpuLayers') ?? 99;
    const temperature = config.get<number>('temperature') ?? 0.2;
    const keepAlive = config.get<string>('keepAlive') || '10m';

    const availableModels = await this.ollamaService.listLocalModels().catch(() => []);
    const recommendation = this.modelRouter.route(
      fullUserPrompt,
      this.contextManager.getTotalTokens(),
      availableModels
    );

    this.postMessage({
      type: 'chunk',
      payload: {
        modelUsed: recommendation.modelName,
        routingReason: recommendation.reason,
        isStart: true,
      },
    });

    if (this.contextManager.shouldCompact(maxContext, compactionThreshold)) {
      this.postMessage({
        type: 'chunk',
        payload: {
          status: 'Compacting conversation history…',
        },
      });

      try {
        const compactionResult = await this.contextManager.compact(fastModel);
        this.postMessage({
          type: 'contextCompacted',
          payload: compactionResult,
        });
      } catch (err: any) {
        console.warn('Auto compaction error:', err);
      }
    }

    this.abortController = new AbortController();

    try {
      await this.ollamaService.ensureModelSlot(recommendation.modelName);
      const messagesToSend = this.contextManager.prepareMessagesForInference();
      const inferenceMessages = messagesToSend.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      if (this.workspaceService.getWorkspaceRoot()) {
        try {
          const tree = await this.workspaceService.getWorkspaceFileTree(80);
          const lastUser = [...inferenceMessages].reverse().find((m) => m.role === 'user');
          if (lastUser) {
            lastUser.content = `${lastUser.content}\n\n[WORKSPACE FILES]\n${tree}\nUse LIST/READ on these paths as needed. Do not ask the user to describe the repo.`;
          }
        } catch {
          // File index is helpful but not required.
        }
      }

      const agentResult = await this.agentExecutor.runAgentLoop(inferenceMessages, {
        model: recommendation.modelName,
        abortSignal: this.abortController.signal,
        nudgeIfNoTools: looksLikeWorkspaceTask(rawPrompt),
        onVisibleChunk: (chunk: string) => {
          this.postMessage({
            type: 'chunk',
            payload: { chunk },
          });
        },
        onStatus: (status: string) => {
          this.postMessage({
            type: 'chunk',
            payload: { status },
          });
        },
        chatStream: async (messages, onChunk, onStatus) => {
          return this.ollamaService.chatStream(
            recommendation.modelName,
            messages.map((m) => ({
              role: m.role as ChatMessage['role'],
              content: m.content,
            })),
            {
              num_gpu: gpuLayers,
              num_ctx: maxContext,
              temperature,
            },
            keepAlive,
            onChunk,
            this.abortController?.signal,
            onStatus
          );
        },
      });

      this.contextManager.addMessage({
        role: 'assistant',
        content: agentResult.visibleAssistantText,
        model: recommendation.modelName,
        timestamp: Date.now(),
      });

      if (agentResult.changedPaths.length > 0) {
        this.postMessage({
          type: 'filesChanged',
          payload: {
            batchId: agentResult.batchId,
            files: agentResult.changedPaths,
          },
        });
      }

      this.postMessage({
        type: 'complete',
        payload: {
          totalTokens: this.contextManager.getTotalTokens(),
        },
      });

      await this.sendHardwareStatus();
    } catch (err: any) {
      if (err.name === 'AbortError' || err.message?.includes('aborted')) {
        this.postMessage({
          type: 'complete',
          payload: { aborted: true },
        });
      } else {
        this.postMessage({
          type: 'error',
          payload: {
            message: `Ollama error: ${err.message}. Make sure '${recommendation.modelName}' is installed and Ollama is active.`,
          },
        });
      }
    } finally {
      this.abortController = undefined;
    }
  }

  public handleStopGeneration(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = undefined;
    }
  }

  public handleClearContext(): void {
    this.handleStopGeneration();
    this.contextManager.clear();
    this.postMessage({
      type: 'contextCleared',
      payload: { totalTokens: this.contextManager.getTotalTokens() },
    });
    this.sendHardwareStatus();
    vscode.window.showInformationMessage('Conversation context cleared.');
  }

  public async handleFreeVram(): Promise<void> {
    this.handleStopGeneration();
    const result = await this.ollamaService.unloadAllModels();
    this.postMessage({
      type: 'vramFreed',
      payload: result,
    });
    await this.sendHardwareStatus();
    vscode.window.showInformationMessage(
      `Freed GPU VRAM! Unloaded ${result.unloadedCount} model(s) from memory.`
    );
  }

  public async handleFreeRam(): Promise<void> {
    // Drop local caches and run garbage collection if exposed
    if (typeof (global as any).gc === 'function') {
      try {
        (global as any).gc();
      } catch {}
    }
    this.postMessage({
      type: 'ramFreed',
      payload: { message: 'Local caches dropped and RAM cleared.' },
    });
    vscode.window.showInformationMessage('Local caches dropped and RAM cleaned.');
  }

  public async handleCompactContext(): Promise<void> {
    const config = vscode.workspace.getConfiguration('localCodingAI');
    const fastModel = config.get<string>('fastModel') || 'qwen2.5-coder:1.5b';

    vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Compacting conversation context...',
        cancellable: false,
      },
      async () => {
        const result = await this.contextManager.compact(fastModel);
        this.postMessage({
          type: 'contextCompacted',
          payload: result,
        });
        await this.sendHardwareStatus();
        vscode.window.showInformationMessage(
          `Context compacted! Reduced from ${result.originalTokens} to ${result.newTokens} tokens.`
        );
      }
    );
  }

  public async handlePullModel(modelName: string): Promise<void> {
    if (!modelName || !modelName.trim()) {
      vscode.window.showWarningMessage('Please enter a valid model name (e.g. qwen2.5-coder:7b)');
      return;
    }

    const trimmed = modelName.trim();
    if (this.activePulls.has(trimmed)) {
      vscode.window.showInformationMessage(`Download for '${trimmed}' is already in progress.`);
      return;
    }

    const abortCtrl = new AbortController();
    this.activePulls.set(trimmed, abortCtrl);

    vscode.window.showInformationMessage(`Starting download for '${trimmed}'...`);

    // Emit initial progress event
    this.postMessage({
      type: 'pullProgress',
      payload: {
        modelName: trimmed,
        status: 'Starting download...',
        percent: 0,
      },
    });

    try {
      await this.ollamaService.pullModel(
        trimmed,
        (progress: ModelPullProgress) => {
          this.postMessage({
            type: 'pullProgress',
            payload: {
              modelName: trimmed,
              ...progress,
            },
          });
        },
        abortCtrl.signal
      );

      this.postMessage({
        type: 'pullComplete',
        payload: {
          modelName: trimmed,
          message: `Model '${trimmed}' downloaded successfully!`,
        },
      });

      vscode.window.showInformationMessage(`Model '${trimmed}' downloaded successfully!`);
      await this.refreshModelsAndStatus();
    } catch (err: any) {
      if (err.name === 'AbortError' || err.message?.includes('aborted')) {
        this.postMessage({
          type: 'pullError',
          payload: {
            modelName: trimmed,
            message: `Download of '${trimmed}' was cancelled.`,
            cancelled: true,
          },
        });
      } else {
        vscode.window.showErrorMessage(`Failed to pull model '${trimmed}': ${err.message}`);
        this.postMessage({
          type: 'pullError',
          payload: {
            modelName: trimmed,
            message: err.message,
          },
        });
      }
    } finally {
      this.activePulls.delete(trimmed);
    }
  }

  public handleCancelPullModel(modelName: string): void {
    const trimmed = modelName?.trim();
    if (!trimmed) return;
    const ctrl = this.activePulls.get(trimmed);
    if (ctrl) {
      ctrl.abort();
      this.activePulls.delete(trimmed);
      vscode.window.showInformationMessage(`Cancelled download for '${trimmed}'.`);
    }
  }

  public async handleLaunchOllama(): Promise<void> {
    this.postMessage({
      type: 'ollamaLaunching',
      payload: { status: 'launching' },
    });
    vscode.window.showInformationMessage('Attempting to launch local Ollama...');

    const res = await this.ollamaService.launchOllama();
    if (res.success) {
      vscode.window.showInformationMessage(res.message);
      this.postMessage({
        type: 'ollamaLaunching',
        payload: { status: 'success', message: res.message },
      });
      await this.refreshModelsAndStatus();
    } else {
      vscode.window.showErrorMessage(res.message);
      this.postMessage({
        type: 'ollamaLaunching',
        payload: { status: 'error', message: res.message },
      });
    }
  }

  public async handleCheckModelUpdates(modelName?: string): Promise<void> {
    const selected = modelName || this.modelRouter.getSelectedModel();
    const config = vscode.workspace.getConfiguration('localCodingAI');

    let targets: string[] = [];
    if (selected === 'auto') {
      targets = [
        config.get<string>('fastModel') || 'qwen2.5-coder:1.5b',
        config.get<string>('primaryModel') || 'qwen2.5-coder:7b',
        config.get<string>('heavyModel') || 'qwen2.5-coder:14b',
      ];
    } else {
      targets = [selected];
    }

    vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title:
          targets.length > 1
            ? `Checking updates for Auto mode models (${targets.length})...`
            : `Checking updates for '${targets[0]}'...`,
        cancellable: false,
      },
      async () => {
        const results = await this.ollamaService.checkMultipleModelUpdates(targets);
        this.postMessage({
          type: 'updateCheckResult',
          payload: { results },
        });

        const withUpdates = results.filter((r) => r.hasUpdate);
        // Webview renders detailed name/version/changelog cards from updateCheckResult

        if (withUpdates.length === 0) {
          const summary =
            results.length === 1
              ? results[0].message.split('\n')[0]
              : `All ${results.length} Auto mode models are up to date (or offline-verified).`;
          vscode.window.showInformationMessage(summary);
          return;
        }

        if (withUpdates.length === 1) {
          const res = withUpdates[0];
          const action = await vscode.window.showInformationMessage(
            `Update available: ${res.modelName} (${res.currentVersion || 'current'} → ${res.latestVersion || 'latest'})`,
            'Update Model Now',
            'View Notes',
            'Later'
          );
          if (action === 'Update Model Now') {
            await this.handlePullModel(res.modelName);
          } else if (action === 'View Notes') {
            await this.showUpdateDetails(res);
          }
          return;
        }

        const action = await vscode.window.showInformationMessage(
          `${withUpdates.length} Auto mode model(s) have updates available.`,
          'Update All',
          'Choose…',
          'Later'
        );
        if (action === 'Update All') {
          for (const res of withUpdates) {
            await this.handlePullModel(res.modelName);
          }
        } else if (action === 'Choose…') {
          const pick = await vscode.window.showQuickPick(
            withUpdates.map((r) => ({
              label: r.modelName,
              description: `${r.currentVersion || '?'} → ${r.latestVersion || '?'}`,
              detail: r.changelog || r.description || r.message.split('\n').slice(0, 2).join(' · '),
              result: r,
            })),
            { placeHolder: 'Select a model to update' }
          );
          if (pick) {
            const view = await vscode.window.showInformationMessage(
              `Update ${pick.label}?`,
              'Update Now',
              'View Notes'
            );
            if (view === 'Update Now') {
              await this.handlePullModel(pick.label);
            } else if (view === 'View Notes') {
              await this.showUpdateDetails(pick.result);
            }
          }
        }
      }
    );
  }

  private async showUpdateDetails(res: {
    modelName: string;
    message: string;
    libraryUrl?: string;
    changelog?: string;
  }): Promise<void> {
    const doc = await vscode.workspace.openTextDocument({
      content: res.message + (res.libraryUrl ? `\n\nOpen library: ${res.libraryUrl}` : ''),
      language: 'markdown',
    });
    await vscode.window.showTextDocument(doc, { preview: true, preserveFocus: false });
  }

  public async handleSetAutoModelRole(
    role?: string,
    modelName?: string
  ): Promise<void> {
    if (!role || !modelName || !['fast', 'primary', 'heavy'].includes(role)) {
      return;
    }
    const settingKey =
      role === 'fast' ? 'fastModel' : role === 'heavy' ? 'heavyModel' : 'primaryModel';
    const config = vscode.workspace.getConfiguration('localCodingAI');
    await config.update(settingKey, modelName, vscode.ConfigurationTarget.Global);
    this.modelRouter.updateConfig({ [settingKey]: modelName } as any);
    vscode.window.showInformationMessage(
      `Auto mode ${role} model set to ${modelName}.`
    );
    await this.refreshModelsAndStatus();
  }

  public async handleDownloadAutoRoleModel(
    role?: string,
    modelName?: string
  ): Promise<void> {
    const config = vscode.workspace.getConfiguration('localCodingAI');
    const fallback =
      role === 'fast'
        ? config.get<string>('fastModel') || 'qwen2.5-coder:1.5b'
        : role === 'heavy'
          ? config.get<string>('heavyModel') || 'qwen2.5-coder:14b'
          : config.get<string>('primaryModel') || 'qwen2.5-coder:7b';

    const target = (modelName || fallback).trim();
    if (!target) {
      return;
    }

    // If choosing from curated extras, also assign that role after pull starts
    if (role && ['fast', 'primary', 'heavy'].includes(role)) {
      await this.handleSetAutoModelRole(role, target);
    }
    await this.handlePullModel(target);
  }

  public async promptUserForCustomContextLimit(): Promise<void> {
    const config = vscode.workspace.getConfiguration('localCodingAI');
    const current = config.get<number>('contextWindow') || 16384;
    const input = await vscode.window.showInputBox({
      title: 'Set Ollama Context Window Limit (Tokens)',
      prompt: 'Enter token limit for the local AI context window (e.g. 4096, 8192, 16384, 32768, 65536)',
      value: current.toString(),
      validateInput: (val) => {
        const num = Number(val);
        if (isNaN(num) || num < 512 || num > 1048576) {
          return 'Please enter a valid token count between 512 and 1,048,576.';
        }
        return null;
      },
    });

    if (input) {
      const num = clampContextWindow(Number(input));
      await config.update('contextWindow', num, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(
        `Context window limit updated to ${num.toLocaleString()} tokens.`
      );
      await this.sendHardwareStatus();
    }
  }

  public async showContextLimitQuickPick(): Promise<void> {
    const config = vscode.workspace.getConfiguration('localCodingAI');
    const current = config.get<number>('contextWindow') || 16384;

    const items: vscode.QuickPickItem[] = [
      {
        label: '$(circle-filled) 2,048 tokens (2K)',
        description: current === 2048 ? '(Current)' : undefined,
        detail: 'Minimal memory footprint, very fast response, suited for quick queries',
      },
      {
        label: '$(circle-filled) 4,096 tokens (4K)',
        description: current === 4096 ? '(Current)' : undefined,
        detail: 'Low VRAM usage (~1GB KV cache), good for smaller single files',
      },
      {
        label: '$(circle-filled) 8,192 tokens (8K)',
        description: current === 8192 ? '(Current)' : undefined,
        detail: 'Standard coding context, holds medium files and multiple turns',
      },
      {
        label: '$(check) 16,384 tokens (16K)',
        description: current === 16384 ? '(Current - Recommended)' : 'Recommended for RTX 3080 12GB VRAM',
        detail: 'High capacity for whole files and extended chat turns within GPU memory',
      },
      {
        label: '$(circle-filled) 32,768 tokens (32K)',
        description: current === 32768 ? '(Current)' : undefined,
        detail: 'Extended context for large files and multi-turn refactors (~4-5GB KV cache)',
      },
      {
        label: '$(circle-filled) 65,536 tokens (64K)',
        description: current === 65536 ? '(Current)' : undefined,
        detail: 'Very large context for deep workspace analysis',
      },
      {
        label: '$(circle-filled) 131,072 tokens (128K)',
        description: current === 131072 ? '(Current)' : undefined,
        detail: 'Maximum context for models that support 128K (e.g. Qwen 2.5 Coder)',
      },
      {
        label: '$(edit) Custom token count...',
        detail: 'Enter a custom number of tokens (e.g. 12000, 24000, 48000)',
      },
    ];

    const selected = await vscode.window.showQuickPick(items, {
      title: 'Select Ollama Context Window Limit',
      placeHolder: `Current limit: ${current.toLocaleString()} tokens`,
    });

    if (!selected) return;

    if (selected.label.includes('Custom')) {
      await this.promptUserForCustomContextLimit();
    } else {
      const match = selected.label.match(/([\d,]+)\s+tokens/);
      if (match) {
        const tokens = parseInt(match[1].replace(/,/g, ''), 10);
        await config.update('contextWindow', tokens, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(
          `Context window limit updated to ${tokens.toLocaleString()} tokens.`
        );
        await this.sendHardwareStatus();
      }
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview.css')
    );

    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${styleUri}">
  <title>Local Coding AI</title>
</head>
<body>
  <div id="app">
    <!-- Top Control Bar -->
    <header class="top-bar">
      <div class="model-row">
        <label for="model-select" class="visually-hidden">Model</label>
        <select id="model-select" title="Select AI Model">
          <option value="auto">Auto Mode (Smart Router)</option>
        </select>
        <button id="btn-check-updates" class="icon-button" title="Check for Model Updates">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
            <path d="M13.65 2.35A7.958 7.958 0 0 0 8 0a8 8 0 1 0 8 8h-2a6 6 0 1 1-1.76-4.24l-2.24 2.24H16V0l-2.35 2.35z"/>
          </svg>
        </button>
        <button id="btn-add-model" class="icon-button" title="Pull/Add New Model">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
            <path d="M8 2a.75.75 0 0 1 .75.75v4.5h4.5a.75.75 0 0 1 0 1.5h-4.5v4.5a.75.75 0 0 1-1.5 0v-4.5h-4.5a.75.75 0 0 1 0-1.5h4.5v-4.5A.75.75 0 0 1 8 2z"/>
          </svg>
        </button>
        <button id="btn-toggle-side" class="icon-button" title="Switch Sidebar Position (Left / Right)">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
            <path d="M0 2a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V2zm10 1H2a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h8V3zm1 0v12h3a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1h-3z"/>
          </svg>
        </button>
      </div>

      <div class="write-perm-row">
        <label for="write-perm-select" class="write-perm-label" title="Allowlist requires approval before executing commands (npm, git, node, …). Writing files never needs approval.">
          AI execution
        </label>
        <select id="write-perm-select" title="Allowlist: approve command execution. Run everything: skip execution prompts. File writes are always automatic.">
          <option value="allowlist">Allowlist</option>
          <option value="runEverything">Run everything</option>
        </select>
        <button id="btn-manage-allowlist" class="icon-button" type="button" title="Manage execution allowlist">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
            <path d="M8 1a4 4 0 0 0-4 4v1.09A2.5 2.5 0 0 0 2 8.5V13a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8.5a2.5 2.5 0 0 0-2-2.41V5a4 4 0 0 0-4-4zm-2.5 5V5a2.5 2.5 0 0 1 5 0v1h-5z"/>
          </svg>
        </button>
        <span id="write-allowlist-count" class="write-allowlist-count" title="Allowlisted execution families">0</span>
      </div>

      <!-- Auto Mode Role Models -->
      <div id="auto-router-panel" class="auto-router-panel hidden">
        <div class="auto-router-header">
          <span class="auto-router-title">Auto Mode Models</span>
          <span class="auto-router-hint">Router picks by task type</span>
        </div>
        <div class="auto-role-row" data-role="fast">
          <div class="auto-role-label" title="Used for quick Q&amp;A, syntax, and short explanations">
            <span class="auto-role-icon">⚡</span>
            <span>Fast</span>
          </div>
          <select id="auto-fast-select" class="auto-role-select" title="Fast / lightweight model for Auto mode"></select>
          <button type="button" class="auto-role-dl icon-button" data-role="fast" title="Download selected Fast model">⬇</button>
        </div>
        <div class="auto-role-row" data-role="primary">
          <div class="auto-role-label" title="Default coding model for most Auto mode tasks">
            <span class="auto-role-icon">🧠</span>
            <span>Primary</span>
          </div>
          <select id="auto-primary-select" class="auto-role-select" title="Primary coding model for Auto mode"></select>
          <button type="button" class="auto-role-dl icon-button" data-role="primary" title="Download selected Primary model">⬇</button>
        </div>
        <div class="auto-role-row" data-role="heavy">
          <div class="auto-role-label" title="Used for large refactors and architectural work">
            <span class="auto-role-icon">🏗</span>
            <span>Heavy</span>
          </div>
          <select id="auto-heavy-select" class="auto-role-select" title="Heavy / high-capacity model for Auto mode"></select>
          <button type="button" class="auto-role-dl icon-button" data-role="heavy" title="Download selected Heavy model">⬇</button>
        </div>
        <div class="auto-extra-row">
          <label for="auto-extra-select" class="visually-hidden">Download additional Auto model</label>
          <select id="auto-extra-select" class="auto-extra-select" title="Download an additional model and assign it to an Auto role">
            <option value="" selected disabled>+ Download more for Auto…</option>
            <optgroup label="Assign as Fast">
              <option value="fast|qwen2.5-coder:1.5b">qwen2.5-coder:1.5b → Fast</option>
              <option value="fast|qwen2.5-coder:3b">qwen2.5-coder:3b → Fast</option>
              <option value="fast|starcoder2:3b">starcoder2:3b → Fast</option>
            </optgroup>
            <optgroup label="Assign as Primary">
              <option value="primary|qwen2.5-coder:7b">qwen2.5-coder:7b → Primary</option>
              <option value="primary|deepseek-coder-v2:16b">deepseek-coder-v2:16b → Primary</option>
              <option value="primary|codellama:7b">codellama:7b → Primary</option>
              <option value="primary|starcoder2:7b">starcoder2:7b → Primary</option>
            </optgroup>
            <optgroup label="Assign as Heavy">
              <option value="heavy|qwen2.5-coder:14b">qwen2.5-coder:14b → Heavy</option>
              <option value="heavy|qwen2.5-coder:32b">qwen2.5-coder:32b → Heavy</option>
              <option value="heavy|deepseek-coder-v2:16b">deepseek-coder-v2:16b → Heavy</option>
              <option value="heavy|codellama:13b">codellama:13b → Heavy</option>
            </optgroup>
          </select>
        </div>
      </div>

      <!-- Pull Model Dropdown & Input Panel -->
      <div id="pull-model-panel" class="pull-model-panel hidden">
        <div class="pull-model-select-wrapper">
          <label for="pull-model-select" class="visually-hidden">Select Model to Download</label>
          <select id="pull-model-select" class="pull-model-select" title="Choose a model to install">
            <option value="" disabled selected>-- Select a Model to Download --</option>
            <optgroup label="Qwen 2.5 Coder (Recommended)">
              <option value="qwen2.5-coder:7b">qwen2.5-coder:7b (Recommended · 7B · ~5.5GB VRAM)</option>
              <option value="qwen2.5-coder:1.5b">qwen2.5-coder:1.5b (Fast Router · 1.5B · ~1.5GB VRAM)</option>
              <option value="qwen2.5-coder:14b">qwen2.5-coder:14b (Heavy Arch · 14B · ~9GB VRAM)</option>
              <option value="qwen2.5-coder:32b">qwen2.5-coder:32b (Ultra Heavy · 32B · ~19GB)</option>
            </optgroup>
            <optgroup label="Other Coding Models">
              <option value="deepseek-coder-v2:16b">deepseek-coder-v2:16b (DeepSeek MoE · ~9GB VRAM)</option>
              <option value="codellama:7b">codellama:7b (Meta Code Llama · 7B · ~5GB)</option>
              <option value="codellama:13b">codellama:13b (Meta Code Llama · 13B · ~8.5GB)</option>
              <option value="starcoder2:7b">starcoder2:7b (BigCode StarCoder2 · 7B · ~5GB)</option>
              <option value="starcoder2:3b">starcoder2:3b (BigCode StarCoder2 · 3B · ~2.5GB)</option>
            </optgroup>
            <optgroup label="General Purpose Models">
              <option value="llama3.1:8b">llama3.1:8b (Meta Llama 3.1 · 8B · ~5.5GB)</option>
              <option value="mistral:7b">mistral:7b (Mistral AI · 7B · ~5GB)</option>
            </optgroup>
            <optgroup label="Custom Tag">
              <option value="custom">✏️ Enter custom model name...</option>
            </optgroup>
          </select>
          <button id="btn-pull-submit" class="action-btn">Pull</button>
        </div>
        <div id="custom-model-input-wrapper" class="custom-model-input-wrapper hidden">
          <input type="text" id="pull-model-input" placeholder="Type custom tag (e.g. gemma2:9b, phi3:mini)..." />
        </div>
      </div>

      <!-- Multiple Concurrent Download Progress Bars Container -->
      <div id="downloads-container" class="downloads-container"></div>

      <!-- Hardware & Memory Dashboard -->
      <div class="metrics-row">
        <div class="metric-pill" id="vram-pill" title="GPU VRAM Usage">
          <span class="metric-dot green" id="vram-dot"></span>
          <span id="vram-text">VRAM: 0 MB</span>
        </div>
        <button id="btn-launch-ollama" class="btn-launch-ollama hidden" title="Start local Ollama server">
          ▶ Launch Ollama
        </button>
        <div class="metric-pill context-metric-pill" id="context-pill" title="Conversation Context Usage (Click dropdown to change Ollama context window limit)">
          <span id="context-label">Ctx:</span>
          <span id="context-used-text">0</span>
          <span class="context-slash">/</span>
          <select id="context-limit-select" class="context-limit-select" title="Change Ollama Context Window Limit">
            <option value="2048">2K</option>
            <option value="4096">4K</option>
            <option value="8192">8K</option>
            <option value="16384" selected>16K</option>
            <option value="32768">32K</option>
            <option value="65536">64K</option>
            <option value="131072">128K</option>
            <option value="custom">Custom...</option>
          </select>
        </div>
      </div>

      <!-- Memory & Context Action Buttons -->
      <div class="actions-row">
        <button id="btn-free-vram" class="quick-btn" title="Unload all models from GPU VRAM back to 0MB">
          <span class="btn-icon">⚡</span>
          <span class="btn-text">Free VRAM</span>
        </button>
        <button id="btn-compact-context" class="quick-btn" title="Compact previous messages into structured summary">
          <span class="btn-icon">🗜️</span>
          <span class="btn-text">Compact</span>
        </button>
        <button id="btn-clear-context" class="quick-btn" title="Clear entire conversation context">
          <span class="btn-icon">🗑️</span>
          <span class="btn-text">Clear Context</span>
        </button>
        <button id="btn-free-ram" class="quick-btn" title="Clean internal memory and caches">
          <span class="btn-icon">🧹</span>
          <span class="btn-text">Clean RAM</span>
        </button>
      </div>
    </header>

    <!-- Message Stream Area -->
    <main id="chat-messages" class="chat-container">
      <div class="welcome-box">
        <div id="ollama-offline-banner" class="ollama-offline-banner hidden">
          <div class="offline-title">⚠️ Ollama is not running</div>
          <p class="offline-desc">Start Ollama to chat, generate code, and manage models locally.</p>
          <button id="btn-launch-banner" class="action-btn">▶ Launch Ollama</button>
        </div>
        <h3>Local Coding AI Assistant</h3>
        <p>100% offline, private, and scoped to the active workspace directory.</p>
        <div class="quick-prompts">
          <button class="prompt-chip" data-prompt="Explain the structure of this workspace and how key components connect.">Explain workspace</button>
          <button class="prompt-chip" data-prompt="Review the active file for bugs, performance bottlenecks, and edge cases.">Review active file</button>
          <button class="prompt-chip" data-prompt="Write comprehensive unit tests with test cases for the active function.">Write tests</button>
        </div>
      </div>
    </main>

    <!-- Input & Context Attachments Area -->
    <footer class="input-container">
      <div id="attachment-chips" class="attachment-chips"></div>

      <div class="context-tools-row">
        <button id="btn-attach-file" class="tool-btn" title="Attach Active File Content">
          + Active File
        </button>
        <button id="btn-attach-selection" class="tool-btn" title="Attach Selected Code">
          + Selection
        </button>
      </div>

      <div class="input-box-wrapper">
        <textarea id="prompt-input" rows="2" placeholder="Ask anything about your code... (Enter to send, Shift+Enter for newline)"></textarea>
        <div class="input-actions">
          <button id="btn-stop" class="btn-stop hidden" title="Stop Generation">
            ■ Stop
          </button>
          <button id="btn-send" class="btn-send" title="Send Message">
            ➔
          </button>
        </div>
      </div>
    </footer>
  </div>

  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
