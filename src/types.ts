export interface ChatMessage {
  id?: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  timestamp?: number;
  model?: string;
  tokens?: number;
}

export interface ModelDetails {
  parent_model?: string;
  format?: string;
  family?: string;
  families?: string[];
  parameter_size?: string;
  quantization_level?: string;
}

export interface OllamaModelInfo {
  name: string;
  model?: string;
  modified_at: string;
  size: number;
  digest: string;
  details?: ModelDetails;
}

export interface RunningModelInfo {
  name: string;
  model: string;
  size: number;
  size_vram: number;
  expires_at: string;
}

export interface ModelPullProgress {
  modelName?: string;
  status: string;
  digest?: string;
  total?: number;
  completed?: number;
  percent?: number;
}

export type AutoModelRole = 'fast' | 'primary' | 'heavy';

export interface AutoRouterConfigSnapshot {
  fastModel: string;
  primaryModel: string;
  heavyModel: string;
  installedNames: string[];
}

export interface ModelUpdateCheckResult {
  modelName: string;
  hasUpdate: boolean;
  message: string;
  /** Human-readable tag / version, e.g. "7b" or "latest" */
  currentVersion?: string;
  latestVersion?: string;
  /** e.g. "7.6B · Q4_K_M · 4.7 GB" */
  currentDetails?: string;
  latestDetails?: string;
  /** Short library blurb */
  description?: string;
  /** Truncated readme / patch notes from the Ollama library page */
  changelog?: string;
  libraryUrl?: string;
  modifiedAt?: string;
  remoteUpdatedHint?: string;
  currentDigest?: string;
  latestDigest?: string;
}

export interface CompactedContextResult {
  summary: string;
  preservedMessages: ChatMessage[];
  originalTokens: number;
  newTokens: number;
}

export interface ModelRecommendation {
  modelName: string;
  reason: string;
  estimatedContextTokens: number;
}

export interface HardwareStatus {
  isConnected: boolean;
  runningModels: RunningModelInfo[];
  totalVramBytes: number;
  freeVramBytesEstimate?: number;
  error?: string;
}

export interface OllamaChatOptions {
  num_gpu?: number;
  num_ctx?: number;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  seed?: number;
  stop?: string[];
}

export interface WebviewToExtensionMessage {
  type:
    | 'sendMessage'
    | 'stopGeneration'
    | 'clearContext'
    | 'freeVram'
    | 'freeRam'
    | 'compactContext'
    | 'getModels'
    | 'getHardwareStatus'
    | 'selectModel'
    | 'pullModel'
    | 'cancelPullModel'
    | 'checkModelUpdates'
    | 'launchOllama'
    | 'setContextLimit'
    | 'promptCustomContextLimit'
    | 'setAutoModelRole'
    | 'downloadAutoRoleModel'
    | 'applyCodeToEditor'
    | 'insertCodeAtCursor'
    | 'copyCode'
    | 'attachActiveFile'
    | 'attachSelection'
    | 'toggleSidebarPosition'
    | 'openSettings';
  payload?: any;
}

export interface ExtensionToWebviewMessage {
  type:
    | 'chunk'
    | 'complete'
    | 'error'
    | 'statusUpdate'
    | 'modelsList'
    | 'modelSelected'
    | 'pullProgress'
    | 'pullComplete'
    | 'pullError'
    | 'updateCheckResult'
    | 'autoConfig'
    | 'ollamaLaunching'
    | 'contextCompacted'
    | 'contextCleared'
    | 'vramFreed'
    | 'ramFreed'
    | 'contextAttached';
  payload?: any;
}
