import { ModelRecommendation, OllamaModelInfo } from '../types';

export type RouterMode = 'auto' | 'manual';

export interface ModelRouterConfig {
  mode: RouterMode;
  selectedModel: string;
  primaryModel: string;
  fastModel: string;
  heavyModel: string;
}

export class ModelRouter {
  private config: ModelRouterConfig;

  constructor(config?: Partial<ModelRouterConfig>) {
    this.config = {
      mode: config?.mode || 'auto',
      selectedModel: config?.selectedModel || 'auto',
      primaryModel: config?.primaryModel || 'qwen2.5-coder:7b',
      fastModel: config?.fastModel || 'qwen2.5-coder:1.5b',
      heavyModel: config?.heavyModel || 'qwen2.5-coder:14b',
    };
  }

  public setMode(mode: RouterMode): void {
    this.config.mode = mode;
  }

  public getMode(): RouterMode {
    return this.config.mode;
  }

  public setSelectedModel(modelName: string): void {
    if (modelName === 'auto' || !modelName) {
      this.config.mode = 'auto';
      this.config.selectedModel = 'auto';
    } else {
      this.config.mode = 'manual';
      this.config.selectedModel = modelName;
    }
  }

  public getSelectedModel(): string {
    return this.config.selectedModel;
  }

  public updateConfig(newConfig: Partial<ModelRouterConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  public getConfig(): ModelRouterConfig {
    return { ...this.config };
  }

  /**
   * Determine the best model to use given the prompt, context size, and installed models
   */
  public route(
    prompt: string,
    contextTokens: number,
    availableModels: OllamaModelInfo[] = []
  ): ModelRecommendation {
    const installedNames = availableModels.map((m) => m.name.toLowerCase());

    // If manual mode is active and selected model is set
    if (this.config.mode === 'manual' && this.config.selectedModel !== 'auto') {
      const match = this.findBestInstalledMatch(this.config.selectedModel, installedNames);
      return {
        modelName: match || this.config.selectedModel,
        reason: `Manually selected: ${match || this.config.selectedModel}`,
        estimatedContextTokens: contextTokens,
      };
    }

    // AUTO ROUTING: Analyze task characteristics
    const lowerPrompt = prompt.toLowerCase();
    const isShortQuery = prompt.length < 150 && contextTokens < 1500;
    const isQuickQuestion =
      isShortQuery &&
      (lowerPrompt.startsWith('what is') ||
        lowerPrompt.startsWith('how to') ||
        lowerPrompt.startsWith('explain') ||
        lowerPrompt.includes('syntax') ||
        lowerPrompt.includes('quick check'));

    const isComplexArchitecture =
      lowerPrompt.includes('architect') ||
      lowerPrompt.includes('refactor entire') ||
      lowerPrompt.includes('system design') ||
      lowerPrompt.includes('database schema migration') ||
      lowerPrompt.includes('complex state machine') ||
      (contextTokens > 10000 && lowerPrompt.includes('refactor'));

    // Check if heavy model should and can be used
    if (isComplexArchitecture) {
      const heavyMatch = this.findBestInstalledMatch(this.config.heavyModel, installedNames);
      if (heavyMatch) {
        return {
          modelName: heavyMatch,
          reason: `Auto routed to high-capacity model (${heavyMatch}) for complex architectural/refactoring task`,
          estimatedContextTokens: contextTokens,
        };
      }
    }

    // Check if fast model can be used for quick queries
    if (isQuickQuestion) {
      const fastMatch = this.findBestInstalledMatch(this.config.fastModel, installedNames);
      if (fastMatch) {
        return {
          modelName: fastMatch,
          reason: `Auto routed to fast model (${fastMatch}) for quick syntax/explanation query`,
          estimatedContextTokens: contextTokens,
        };
      }
    }

    // Default to primary coding model (Qwen 2.5 Coder 7B - optimum for RTX 3080 12GB VRAM)
    const primaryMatch = this.findBestInstalledMatch(this.config.primaryModel, installedNames);
    if (primaryMatch) {
      return {
        modelName: primaryMatch,
        reason: `Auto routed to primary model (${primaryMatch}) optimized for coding & 12GB VRAM`,
        estimatedContextTokens: contextTokens,
      };
    }

    // If configured primary model is not yet downloaded, pick any available installed model
    if (availableModels.length > 0) {
      // Prefer models with "coder" or "qwen" or "code"
      const coderModel = availableModels.find(
        (m) =>
          m.name.toLowerCase().includes('coder') ||
          m.name.toLowerCase().includes('code') ||
          m.name.toLowerCase().includes('qwen')
      );
      const fallbackModel = coderModel ? coderModel.name : availableModels[0].name;

      return {
        modelName: fallbackModel,
        reason: `Using installed model (${fallbackModel}) as fallback`,
        estimatedContextTokens: contextTokens,
      };
    }

    // Default configured model if Ollama has no tags yet
    return {
      modelName: this.config.primaryModel,
      reason: `Default configured primary model (${this.config.primaryModel})`,
      estimatedContextTokens: contextTokens,
    };
  }

  /**
   * Helper to match model name (e.g. "qwen2.5-coder:7b" matches "qwen2.5-coder:7b-instruct" or "qwen2.5-coder:latest")
   */
  private findBestInstalledMatch(target: string, installedNames: string[]): string | undefined {
    const targetLower = target.toLowerCase();

    // Exact match
    const exact = installedNames.find((name) => name === targetLower);
    if (exact) return exact;

    // Match with or without tag prefix
    const baseTarget = targetLower.split(':')[0];
    const prefixMatches = installedNames.filter((name) => name.startsWith(baseTarget));
    if (prefixMatches.length > 0) {
      // If target had a specific tag like :7b, see if one of the prefix matches contains it
      if (targetLower.includes(':')) {
        const tag = targetLower.split(':')[1];
        const tagMatch = prefixMatches.find((name) => name.includes(tag));
        if (tagMatch) return tagMatch;
      }
      return prefixMatches[0];
    }

    return undefined;
  }
}
