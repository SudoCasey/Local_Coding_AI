import {
  AgentToolCall,
  formatToolResultsForModel,
  parseAgentResponse,
} from './agentProtocol';
import { ChangeTracker } from './changeTracker';
import { normalizeWriteActionType } from './writePermissionPolicy';
import { WritePermissionService } from './writePermission';
import { WorkspaceService } from './workspaceService';

const MAX_AGENT_ROUNDS = 6;

export interface AgentLoopOptions {
  model: string;
  chatStream: (
    messages: { role: string; content: string }[],
    onChunk: (chunk: string) => void,
    onStatus?: (status: string) => void
  ) => Promise<string>;
  onVisibleChunk: (chunk: string) => void;
  onStatus?: (status: string) => void;
  abortSignal?: AbortSignal;
}

export interface AgentLoopResult {
  visibleAssistantText: string;
  batchId: string;
  changedPaths: string[];
  rawRounds: number;
}

export class AgentExecutor {
  constructor(
    private workspace: WorkspaceService,
    private writePermissions: WritePermissionService,
    private changeTracker: ChangeTracker
  ) {}

  public async runAgentLoop(
    initialMessages: { role: string; content: string }[],
    options: AgentLoopOptions
  ): Promise<AgentLoopResult> {
    const batchId = this.changeTracker.startBatch();
    const workingMessages = initialMessages.map((m) => ({ ...m }));
    let visibleAssistantText = '';
    let rounds = 0;

    while (rounds < MAX_AGENT_ROUNDS) {
      if (options.abortSignal?.aborted) {
        break;
      }
      rounds += 1;

      let rawRound = '';
      await options.chatStream(
        workingMessages,
        (chunk) => {
          rawRound += chunk;
        },
        options.onStatus
      );

      const parsed = parseAgentResponse(rawRound);
      if (parsed.displayText) {
        const piece =
          visibleAssistantText.length > 0
            ? `\n\n${parsed.displayText}`
            : parsed.displayText;
        visibleAssistantText = `${visibleAssistantText}${piece}`.trim();
        options.onVisibleChunk(piece.startsWith('\n\n') ? piece : parsed.displayText);
      }

      for (const line of parsed.statusLines) {
        options.onStatus?.(line);
      }

      if (parsed.toolCalls.length === 0) {
        if (!visibleAssistantText.trim()) {
          visibleAssistantText = parsed.displayText || rawRound.trim();
          if (visibleAssistantText && !parsed.displayText) {
            options.onVisibleChunk(visibleAssistantText);
          }
        }
        break;
      }

      // Store assistant raw (with protocol) for model continuity
      workingMessages.push({ role: 'assistant', content: rawRound });

      const results: string[] = [];
      for (const call of parsed.toolCalls) {
        if (options.abortSignal?.aborted) {
          break;
        }
        results.push(await this.executeTool(call, batchId));
      }

      const toolMsg = formatToolResultsForModel(results);
      workingMessages.push({ role: 'user', content: toolMsg });
    }

    return {
      visibleAssistantText: visibleAssistantText.trim() || '(No assistant text)',
      batchId,
      changedPaths: this.changeTracker.listChangedPaths(batchId),
      rawRounds: rounds,
    };
  }

  private async executeTool(call: AgentToolCall, batchId: string): Promise<string> {
    switch (call.kind) {
      case 'read': {
        const res = await this.workspace.readWorkspaceFile(call.path);
        if (!res.ok) {
          return `READ ${call.path} ERROR: ${res.error}`;
        }
        return `READ ${res.path}:\n${res.content}`;
      }
      case 'list': {
        const res = await this.workspace.listWorkspaceDir(call.path);
        if (!res.ok) {
          return `LIST ${call.path} ERROR: ${res.error}`;
        }
        return `LIST ${res.path}:\n${res.entries}`;
      }
      case 'write': {
        const res = await this.workspace.writeWorkspaceFile(call.path, call.content);
        if (!res.ok) {
          return `WRITE ${call.path} ERROR: ${res.error}`;
        }
        this.changeTracker.recordWrite(batchId, res.path, res.before, call.content);
        return `WRITE ${res.path}: ok (${res.created ? 'created' : 'updated'})`;
      }
      case 'search_replace': {
        const res = await this.workspace.applySearchReplace(
          call.path,
          call.search,
          call.replace
        );
        if (!res.ok) {
          return `SEARCH/REPLACE ${call.path} ERROR: ${res.error}`;
        }
        this.changeTracker.recordWrite(batchId, res.path, res.before, res.after);
        return `SEARCH/REPLACE ${res.path}: ok`;
      }
      case 'run': {
        const actionType = normalizeWriteActionType('shell', call.command);
        const allowed = await this.writePermissions.requestPermission(
          actionType,
          `Execute command:\n${call.command}`
        );
        if (!allowed) {
          return `RUN denied by user (Allowlist). Command not executed: ${call.command}`;
        }
        const result = await this.workspace.runWorkspaceCommand(call.command, {
          timeoutMs: 90000,
        });
        const parts = [
          `RUN ${call.command}`,
          `exit=${result.exitCode}`,
          result.timedOut ? 'TIMED OUT' : '',
          result.error ? `error: ${result.error}` : '',
          result.stdout ? `stdout:\n${result.stdout}` : '',
          result.stderr ? `stderr:\n${result.stderr}` : '',
        ].filter(Boolean);
        return parts.join('\n');
      }
      default:
        return 'Unknown tool call';
    }
  }

  public async undoBatch(batchId: string): Promise<{ restored: string[]; errors: string[] }> {
    const records = this.changeTracker.takeBatchForUndo(batchId);
    const restored: string[] = [];
    const errors: string[] = [];
    // Undo in reverse order
    for (const rec of [...records].reverse()) {
      if (rec.created) {
        const del = await this.workspace.deleteWorkspaceFile(rec.path);
        if (del.ok) {
          restored.push(rec.path);
        } else {
          errors.push(del.error);
        }
      } else if (rec.before !== null) {
        const wrote = await this.workspace.writeWorkspaceFile(rec.path, rec.before);
        if (wrote.ok) {
          restored.push(rec.path);
        } else {
          errors.push(wrote.error);
        }
      }
    }
    return { restored, errors };
  }
}
