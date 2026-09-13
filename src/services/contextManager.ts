import { ChatMessage, CompactedContextResult } from '../types';
import { OllamaService } from './ollamaService';

export class ContextManager {
  private messages: ChatMessage[] = [];
  private baseSystemPrompt: string;
  private systemPrompt: string = '';
  private ollamaService: OllamaService;
  private workspaceRoot?: string;

  constructor(ollamaService: OllamaService, workspaceRoot?: string, customPrompt?: string) {
    this.ollamaService = ollamaService;
    this.workspaceRoot = workspaceRoot;
    this.baseSystemPrompt =
      customPrompt ||
      `You are an expert local AI software engineering assistant running inside VS Code.
You write clean, secure, idiomatic, and high-performance code across all web development stacks (HTML, CSS, JavaScript, TypeScript, React, Next.js, Node.js, PHP, SQL) and general programming languages (Python, Go, Rust, C++).
- Always be concise, helpful, and technically accurate.
- Provide complete code snippets when writing or modifying code.
- If referencing files or code, maintain the exact names, paths, and patterns used in the workspace.
- Avoid unnecessary conversational filler. Focus on working, production-ready solutions.`;

    this.buildSystemPrompt();
  }

  public setWorkspaceRoot(root?: string): void {
    this.workspaceRoot = root;
    this.buildSystemPrompt();
  }

  public getWorkspaceRoot(): string | undefined {
    return this.workspaceRoot;
  }

  private buildSystemPrompt(): void {
    const boundary = this.workspaceRoot
      ? `\n\nSTRICT WORKSPACE BOUNDARY & DIRECTORY ISOLATION RULES:
1. WORKSPACE ROOT DIRECTORY: "${this.workspaceRoot}"
2. You operate strictly within this opened workspace directory. You do NOT have access to, and must NEVER attempt to access, read, write, reference, or execute anything outside of this workspace directory.
3. All code modifications, files created, files referenced, and commands must be strictly scoped to this workspace directory.
4. Attempt to complete all user requests, prompts, features, and fixes entirely within the files and tools in this directory. If a needed file or dependency does not exist, propose creating or installing it within this workspace rather than looking outside.
5. When referencing files, always use clean relative paths starting from the workspace root (e.g. "src/index.ts", "package.json").`
      : `\n\nSTRICT WORKSPACE BOUNDARY:
Operate strictly within the active project directory. Do not attempt to access or suggest files outside the opened workspace root. Attempt to complete all prompts within the directory.`;

    this.systemPrompt = `${this.baseSystemPrompt}${boundary}`;
  }

  public getMessages(): ChatMessage[] {
    return [...this.messages];
  }

  public setMessages(messages: ChatMessage[]): void {
    this.messages = [...messages];
  }

  public setSystemPrompt(prompt: string): void {
    this.systemPrompt = prompt;
  }

  public getSystemPrompt(): string {
    return this.systemPrompt;
  }

  public addMessage(message: ChatMessage): void {
    this.messages.push({
      ...message,
      timestamp: message.timestamp || Date.now(),
      tokens: this.estimateTokens(message.content),
    });
  }

  public updateLastAssistantMessage(content: string): void {
    if (this.messages.length > 0 && this.messages[this.messages.length - 1].role === 'assistant') {
      this.messages[this.messages.length - 1].content = content;
      this.messages[this.messages.length - 1].tokens = this.estimateTokens(content);
    } else {
      this.addMessage({ role: 'assistant', content });
    }
  }

  public clear(): void {
    this.messages = [];
  }

  /**
   * Estimates tokens for a given string.
   * On code and technical text, 1 token is roughly 3.6 characters.
   */
  public estimateTokens(text: string): number {
    if (!text) return 0;
    // Count whitespace chunks, punctuation, and alphanumerics
    const codeTokensMatch = text.match(/\w+|[^\w\s]|\s+/g);
    if (!codeTokensMatch) {
      return Math.ceil(text.length / 3.6);
    }
    // Blend character count heuristic with word/symbol chunking
    const chunkCount = codeTokensMatch.length;
    const charHeuristic = Math.ceil(text.length / 3.6);
    return Math.max(Math.ceil((chunkCount + charHeuristic) / 2), 1);
  }

  /**
   * Total tokens in current conversation including the system prompt
   */
  public getTotalTokens(): number {
    let tokens = this.estimateTokens(this.systemPrompt);
    for (const msg of this.messages) {
      tokens += msg.tokens || this.estimateTokens(msg.content);
    }
    return tokens;
  }

  /**
   * Checks whether the current context exceeds the threshold ratio
   */
  public shouldCompact(maxContextTokens: number = 16384, thresholdRatio: number = 0.75): boolean {
    const currentTokens = this.getTotalTokens();
    const threshold = maxContextTokens * thresholdRatio;
    return currentTokens >= threshold && this.messages.length > 4;
  }

  /**
   * Compacts older conversation history into a structured summary
   * while keeping recent messages intact to maintain active task context.
   */
  public async compact(
    compactionModel: string = 'qwen2.5-coder:1.5b',
    keepRecentCount: number = 3
  ): Promise<CompactedContextResult> {
    const originalTokens = this.getTotalTokens();

    if (this.messages.length <= keepRecentCount + 1) {
      return {
        summary: 'Context size is already compact.',
        preservedMessages: [...this.messages],
        originalTokens,
        newTokens: originalTokens,
      };
    }

    const messagesToCompact = this.messages.slice(0, this.messages.length - keepRecentCount);
    const recentMessages = this.messages.slice(this.messages.length - keepRecentCount);

    let summaryText = '';

    try {
      const historyTranscript = messagesToCompact
        .map((m) => `[${m.role.toUpperCase()}]: ${m.content}`)
        .join('\n\n');

      const prompt = `You are an AI context compaction engine. Your job is to compress the following conversation history into a concise, high-density structured summary.
Preserve all crucial technical facts, requirements, files discussed, code changes made, and current progress.

Conversation History to compress:
"""
${historyTranscript.slice(0, 20000)}
"""

Produce a concise technical summary in the following markdown format:
### Project & Goal Summary:
- (Main objectives requested by the user)
### Key Decisions & Architecture:
- (Tools, libraries, patterns, conventions agreed upon)
### Files & Code Touched:
- (Files read, written, or modified)
### Current State & Pending Tasks:
- (What was completed and what remains to be done)

Do not include conversational banter. Output only the structured summary.`;

      summaryText = await this.ollamaService.generateCompletion(compactionModel, prompt, {
        temperature: 0.1,
        num_ctx: 8192,
      });

      if (!summaryText.trim()) {
        throw new Error('Empty summary returned from model');
      }
    } catch {
      // Deterministic fallback if model completion fails
      summaryText = this.deterministicFallbackCompaction(messagesToCompact);
    }

    const compactedSystemMessage: ChatMessage = {
      role: 'system',
      content: `[CONTEXT COMPACTION SUMMARY: Previous conversation has been compacted to save memory while preserving all task state]\n\n${summaryText.trim()}`,
      timestamp: Date.now(),
      tokens: this.estimateTokens(summaryText),
    };

    this.messages = [compactedSystemMessage, ...recentMessages];
    const newTokens = this.getTotalTokens();

    return {
      summary: summaryText,
      preservedMessages: this.messages,
      originalTokens,
      newTokens,
    };
  }

  /**
   * Fallback rule-based summarizer when LLM call is unavailable
   */
  private deterministicFallbackCompaction(messages: ChatMessage[]): string {
    const userTopics: string[] = [];
    const codeBlocks: string[] = [];

    for (const msg of messages) {
      if (msg.role === 'user') {
        const preview = msg.content.split('\n')[0].substring(0, 100);
        userTopics.push(preview);
      } else if (msg.role === 'assistant') {
        const codeMatches = msg.content.match(/```[\s\S]*?```/g);
        if (codeMatches) {
          codeBlocks.push(...codeMatches.slice(0, 2));
        }
      }
    }

    return `### Historical Task Context (Extractive Summary):
- User Requests:
${userTopics.map((t) => `  * ${t}`).join('\n')}
- Extracted references:
${codeBlocks.length > 0 ? codeBlocks.join('\n') : '  * Code and discussions retained in workspace.'}`;
  }

  /**
   * Prepares messages to be sent to Ollama chat API,
   * injecting the system prompt as the first message.
   */
  public prepareMessagesForInference(): ChatMessage[] {
    const systemMsg: ChatMessage = {
      role: 'system',
      content: this.systemPrompt,
      tokens: this.estimateTokens(this.systemPrompt),
    };
    return [systemMsg, ...this.messages];
  }
}
