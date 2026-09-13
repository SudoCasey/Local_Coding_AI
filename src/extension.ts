import * as vscode from 'vscode';
import { ContextManager } from './services/contextManager';
import { ModelRouter } from './services/modelRouter';
import { OllamaService } from './services/ollamaService';
import { WorkspaceService } from './services/workspaceService';
import { SidebarProvider } from './sidebar/SidebarProvider';

let statusBarItem: vscode.StatusBarItem;
let statusInterval: NodeJS.Timeout | undefined;
let sidebarProvider: SidebarProvider | undefined;
let ollamaService: OllamaService | undefined;
let isDeactivating = false;

export function activate(context: vscode.ExtensionContext) {
  isDeactivating = false;
  const config = vscode.workspace.getConfiguration('localCodingAI');
  const ollamaUrl = config.get<string>('ollamaUrl') || 'http://127.0.0.1:11434';
  const primaryModel = config.get<string>('primaryModel') || 'qwen2.5-coder:7b';
  const fastModel = config.get<string>('fastModel') || 'qwen2.5-coder:1.5b';
  const heavyModel = config.get<string>('heavyModel') || 'qwen2.5-coder:14b';
  const autoRouting = config.get<boolean>('autoModelRouting') ?? true;

  // Initialize core services
  const workspaceService = new WorkspaceService();
  const workspaceRoot = workspaceService.getWorkspaceRoot();
  ollamaService = new OllamaService(ollamaUrl);
  const contextManager = new ContextManager(ollamaService, workspaceRoot);
  const modelRouter = new ModelRouter({
    mode: autoRouting ? 'auto' : 'manual',
    selectedModel: autoRouting ? 'auto' : primaryModel,
    primaryModel,
    fastModel,
    heavyModel,
  });

  // Keep context manager updated if workspace folders change
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      const newRoot = workspaceService.getWorkspaceRoot();
      contextManager.setWorkspaceRoot(newRoot);
    })
  );

  // Create Sidebar Webview Provider
  sidebarProvider = new SidebarProvider(
    context.extensionUri,
    ollamaService,
    contextManager,
    modelRouter,
    workspaceService
  );

  // Register Webview View Providers for both Left (Activity Bar) and Right (Secondary Side Bar)
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SidebarProvider.primaryViewType, sidebarProvider, {
      webviewOptions: {
        retainContextWhenHidden: true,
      },
    }),
    vscode.window.registerWebviewViewProvider(SidebarProvider.secondaryViewType, sidebarProvider, {
      webviewOptions: {
        retainContextWhenHidden: true,
      },
    })
  );

  // Status Bar Item
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'localCodingAI.openChat';
  statusBarItem.text = '$(circuit-board) Local AI';
  statusBarItem.tooltip = 'Local Coding AI (Click to open sidebar)';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Setup periodic status bar updates
  const updateStatusBar = async () => {
    if (isDeactivating || !ollamaService) {
      return;
    }
    try {
      const status = await ollamaService.getHardwareStatus();
      if (status.isConnected) {
        const vramMb = Math.round(status.totalVramBytes / (1024 * 1024));
        const vramText = vramMb > 1024 ? `${(vramMb / 1024).toFixed(1)}GB` : `${vramMb}MB`;
        const activeModel = modelRouter.getSelectedModel();
        statusBarItem.text = `$(circuit-board) Local AI: ${activeModel} [${vramText}]`;
        statusBarItem.command = 'localCodingAI.openChat';
        statusBarItem.tooltip = `Connected to Ollama. Running models: ${status.runningModels.map((m) => m.name).join(', ') || 'None (0MB)'}`;
      } else {
        statusBarItem.text = '$(play) Local AI: Launch Ollama';
        statusBarItem.command = 'localCodingAI.launchOllama';
        statusBarItem.tooltip = 'Ollama is offline. Click to launch Ollama.';
      }
    } catch {
      statusBarItem.text = '$(play) Local AI: Launch Ollama';
      statusBarItem.command = 'localCodingAI.launchOllama';
      statusBarItem.tooltip = 'Ollama is offline. Click to launch Ollama.';
    }
  };

  updateStatusBar();
  statusInterval = setInterval(updateStatusBar, 10000);

  // Ensure timers / provider resources are freed with the extension host lifecycle
  context.subscriptions.push({
    dispose: () => {
      if (statusInterval) {
        clearInterval(statusInterval);
        statusInterval = undefined;
      }
    },
  });
  context.subscriptions.push({
    dispose: () => {
      sidebarProvider?.dispose();
    },
  });

  // Configuration change listener
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (isDeactivating || !ollamaService || !sidebarProvider) {
        return;
      }
      if (e.affectsConfiguration('localCodingAI')) {
        const newConfig = vscode.workspace.getConfiguration('localCodingAI');
        const newUrl = newConfig.get<string>('ollamaUrl') || 'http://127.0.0.1:11434';
        ollamaService.setBaseUrl(newUrl);

        modelRouter.updateConfig({
          primaryModel: newConfig.get<string>('primaryModel') || 'qwen2.5-coder:7b',
          fastModel: newConfig.get<string>('fastModel') || 'qwen2.5-coder:1.5b',
          heavyModel: newConfig.get<string>('heavyModel') || 'qwen2.5-coder:14b',
        });

        if (e.affectsConfiguration('localCodingAI.sidebarPosition')) {
          await focusChatView();
        }

        sidebarProvider.refreshModelsAndStatus();
        updateStatusBar();
      }
    })
  );

  function getTargetViewId(): string {
    const pos = vscode.workspace.getConfiguration('localCodingAI').get<string>('sidebarPosition');
    return pos === 'right' ? SidebarProvider.secondaryViewType : SidebarProvider.primaryViewType;
  }

  async function focusChatView(): Promise<void> {
    await vscode.commands.executeCommand(`${getTargetViewId()}.focus`);
  }

  // Register Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('localCodingAI.openChat', async () => {
      await focusChatView();
    }),

    vscode.commands.registerCommand('localCodingAI.toggleSidebarPosition', async () => {
      const config = vscode.workspace.getConfiguration('localCodingAI');
      const currentPos = config.get<string>('sidebarPosition') || 'left';
      const newPos = currentPos === 'left' ? 'right' : 'left';
      await config.update('sidebarPosition', newPos, vscode.ConfigurationTarget.Global);
      await focusChatView();
      vscode.window.showInformationMessage(
        `Local Coding AI moved to ${newPos === 'right' ? 'Right (Secondary Side Bar)' : 'Left (Primary Activity Bar)'}.`
      );
    }),

    vscode.commands.registerCommand('localCodingAI.launchOllama', async () => {
      await sidebarProvider?.handleLaunchOllama();
      updateStatusBar();
    }),

    vscode.commands.registerCommand('localCodingAI.clearContext', () => {
      sidebarProvider?.handleClearContext();
    }),

    vscode.commands.registerCommand('localCodingAI.freeVram', async () => {
      await sidebarProvider?.handleFreeVram();
      updateStatusBar();
    }),

    vscode.commands.registerCommand('localCodingAI.freeRam', async () => {
      await sidebarProvider?.handleFreeRam();
    }),

    vscode.commands.registerCommand('localCodingAI.compactContext', async () => {
      await sidebarProvider?.handleCompactContext();
    }),

    vscode.commands.registerCommand('localCodingAI.setContextLimit', async () => {
      await sidebarProvider?.showContextLimitQuickPick();
    }),

    vscode.commands.registerCommand('localCodingAI.checkModelUpdates', async () => {
      await sidebarProvider?.handleCheckModelUpdates();
    }),

    vscode.commands.registerCommand('localCodingAI.explainCode', async () => {
      if (!sidebarProvider) return;
      await sendEditorContextAction(
        sidebarProvider,
        workspaceService,
        'Explain this code in detail, highlighting logic, key variables, and architecture:'
      );
    }),

    vscode.commands.registerCommand('localCodingAI.refactorCode', async () => {
      if (!sidebarProvider) return;
      await sendEditorContextAction(
        sidebarProvider,
        workspaceService,
        'Refactor this code to improve clarity, performance, and best practices. Provide the complete refactored code:'
      );
    }),

    vscode.commands.registerCommand('localCodingAI.generateTests', async () => {
      if (!sidebarProvider) return;
      await sendEditorContextAction(
        sidebarProvider,
        workspaceService,
        'Generate comprehensive unit tests for this code, covering standard behavior and edge cases:'
      );
    }),

    vscode.commands.registerCommand('localCodingAI.fixCode', async () => {
      if (!sidebarProvider) return;
      await sendEditorContextAction(
        sidebarProvider,
        workspaceService,
        'Analyze this code for bugs, logic errors, or performance issues, and explain the fix with corrected code:'
      );
    })
  );
}

async function sendEditorContextAction(
  provider: SidebarProvider,
  workspaceService: WorkspaceService,
  promptPrefix: string
): Promise<void> {
  const editorCtx = workspaceService.getActiveEditorContext();
  if (!editorCtx) {
    vscode.window.showWarningMessage('No active editor file to analyze.');
    return;
  }

  const codeToAnalyze = editorCtx.selectedText || editorCtx.fullContent;
  if (!codeToAnalyze || !codeToAnalyze.trim()) {
    vscode.window.showWarningMessage('File or selection is empty.');
    return;
  }

  const pos = vscode.workspace.getConfiguration('localCodingAI').get<string>('sidebarPosition');
  const targetView = pos === 'right' ? SidebarProvider.secondaryViewType : SidebarProvider.primaryViewType;
  await vscode.commands.executeCommand(`${targetView}.focus`);

  const formattedCode = `\`\`\`${editorCtx.languageId || ''} // ${editorCtx.relativePath || editorCtx.fileName}\n${codeToAnalyze}\n\`\`\``;
  const prompt = `${promptPrefix}\n\n${formattedCode}`;

  await provider.handleUserMessage({ prompt });
}

/**
 * Called when the extension is deactivated (VS Code closing, reload, disable).
 * Releases timers, aborts network work, clears chat memory, and unloads models from VRAM.
 * Does not kill the Ollama daemon itself (it may be shared with other tools).
 */
export async function deactivate(): Promise<void> {
  isDeactivating = true;

  if (statusInterval) {
    clearInterval(statusInterval);
    statusInterval = undefined;
  }

  try {
    if (sidebarProvider) {
      await sidebarProvider.disposeAsync();
    } else if (ollamaService) {
      await Promise.race([
        ollamaService.unloadAllModels(),
        new Promise<void>((resolve) => setTimeout(resolve, 2500)),
      ]);
    }
  } catch {
    // Best-effort cleanup only
  } finally {
    sidebarProvider = undefined;
    ollamaService = undefined;
  }
}
