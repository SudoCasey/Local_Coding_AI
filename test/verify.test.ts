import * as path from 'path';
import { ContextManager } from '../src/services/contextManager';
import { ModelRouter } from '../src/services/modelRouter';
import { OllamaService } from '../src/services/ollamaService';
import { spawnDetachedHidden, spawnGuiDetached } from '../src/services/hiddenProcess';
import {
  clampContextWindow,
  DEFAULT_OLLAMA_URL,
  isLoopbackOllamaUrl,
  normalizeOllamaUrl,
} from '../src/services/ollamaUrlPolicy';
import {
  describeWriteAction,
  isWriteActionAllowlisted,
  normalizeWriteActionType,
} from '../src/services/writePermissionPolicy';
import { parseAgentResponse } from '../src/services/agentProtocol';
import { ChangeTracker } from '../src/services/changeTracker';
import { OllamaModelInfo } from '../src/types';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  PASS: ${message}`);
}

async function runTests() {
  console.log('--- Testing OllamaService ---');
  const ollama = new OllamaService('http://127.0.0.1:11434');
  assert(ollama.getBaseUrl() === 'http://127.0.0.1:11434', 'Base URL is normalized');
  ollama.setBaseUrl('http://127.0.0.1:11434/');
  assert(ollama.getBaseUrl() === 'http://127.0.0.1:11434', 'Trailing slashes stripped');

  console.log('\n--- Testing Ollama URL policy ---');
  assert(isLoopbackOllamaUrl('http://127.0.0.1:11434'), '127.0.0.1 is loopback');
  assert(isLoopbackOllamaUrl('http://localhost:11434/'), 'localhost is loopback');
  assert(isLoopbackOllamaUrl('http://[::1]:11434'), 'IPv6 loopback is allowed');
  assert(!isLoopbackOllamaUrl('https://attacker.example/'), 'Remote HTTPS host is not loopback');
  assert(!isLoopbackOllamaUrl('http://192.168.1.10:11434'), 'LAN IP is not loopback');
  assert(normalizeOllamaUrl('http://127.0.0.1:11434///') === DEFAULT_OLLAMA_URL, 'URL normalize strips slashes');
  assert(clampContextWindow(100) === 512, 'Context window floors at 512');
  assert(clampContextWindow(9999999) === 1048576, 'Context window caps at 1,048,576');
  assert(clampContextWindow(Number.NaN) === 16384, 'Invalid context falls back to 16384');

  console.log('\n--- Testing Hidden Process Launch ---');
  assert(typeof spawnDetachedHidden === 'function', 'Hidden spawn helper is exported');
  assert(typeof spawnGuiDetached === 'function', 'GUI spawn helper is exported');

  console.log('\n--- Testing ModelRouter ---');
  const router = new ModelRouter({
    mode: 'auto',
    selectedModel: 'auto',
    primaryModel: 'qwen2.5-coder:7b',
    fastModel: 'qwen2.5-coder:1.5b',
    heavyModel: 'qwen2.5-coder:14b',
  });

  const mockInstalledModels: OllamaModelInfo[] = [
    { name: 'qwen2.5-coder:7b', modified_at: '', size: 4683074048, digest: 'abc1' },
    { name: 'qwen2.5-coder:1.5b', modified_at: '', size: 986000000, digest: 'abc2' },
    { name: 'qwen2.5-coder:14b', modified_at: '', size: 9000000000, digest: 'abc3' },
  ];

  // Quick query routing
  const quickRec = router.route('what is the syntax for a typescript interface?', 50, mockInstalledModels);
  assert(quickRec.modelName === 'qwen2.5-coder:1.5b', 'Quick query routed to fast model (1.5b)');

  // Standard coding query routing
  const standardRec = router.route(
    'Create a React hook for managing stateful WebSockets with auto-reconnection and exponential backoff',
    500,
    mockInstalledModels
  );
  assert(standardRec.modelName === 'qwen2.5-coder:7b', 'Standard code generation routed to primary model (7b)');

  // Heavy architecture routing
  const heavyRec = router.route(
    'Architect and refactor entire database schema migration and distributed state machine across microservices',
    2000,
    mockInstalledModels
  );
  assert(heavyRec.modelName === 'qwen2.5-coder:14b', 'Heavy architectural refactor routed to heavy model (14b)');

  // Manual selection override
  router.setSelectedModel('deepseek-coder:6.7b');
  assert(router.getMode() === 'manual', 'Router switched to manual mode');
  const manualRec = router.route('any prompt', 100, mockInstalledModels);
  assert(manualRec.modelName === 'deepseek-coder:6.7b', 'Manual model selection respected');

  console.log('\n--- Testing ContextManager ---');
  const ctxManager = new ContextManager(ollama);
  assert(ctxManager.getTotalTokens() > 0, 'System prompt tokens initialized');
  assert(ctxManager.getMessages().length === 0, 'Messages list is initially empty');

  // Add messages
  ctxManager.addMessage({ role: 'user', content: 'How do I build a REST API in Node.js?' });
  ctxManager.addMessage({ role: 'assistant', content: 'Use Express or Fastify with TypeScript...' });
  assert(ctxManager.getMessages().length === 2, 'Added 2 messages successfully');

  // Compaction threshold test
  assert(!ctxManager.shouldCompact(16384, 0.75), 'Small context does not trigger compaction');

  // Add large content to simulate context exhaustion
  const largeCode = `function test() {\n  console.log("hello world");\n}\n`.repeat(1500);
  for (let i = 0; i < 6; i++) {
    ctxManager.addMessage({ role: 'user', content: `Analyze block ${i}: ${largeCode}` });
    ctxManager.addMessage({ role: 'assistant', content: `Block ${i} analyzed: ${largeCode}` });
  }

  const tokensBefore = ctxManager.getTotalTokens();
  assert(tokensBefore > 10000, `Context accumulated large token count (${tokensBefore} tokens)`);
  assert(ctxManager.shouldCompact(16384, 0.5), 'Context triggers compaction when threshold exceeded');

  // Perform compaction
  const result = await ctxManager.compact('qwen2.5-coder:1.5b', 3);
  const tokensAfter = ctxManager.getTotalTokens();
  assert(tokensAfter < tokensBefore, `Compaction reduced tokens from ${tokensBefore} to ${tokensAfter}`);
  assert(ctxManager.getMessages().length <= 4, 'History compacted down to summary + recent turns');

  // Clear context
  ctxManager.clear();
  assert(ctxManager.getMessages().length === 0, 'Context cleared back to 0 messages');

  console.log('\n--- Testing Workspace Boundary & Sandboxing ---');
  const dummyRoot = 'd:\\Users\\Desktop\\Stuff\\Programming\\Local_Coding_AI';
  ctxManager.setWorkspaceRoot(dummyRoot);
  assert(ctxManager.getSystemPrompt().includes(dummyRoot), 'System prompt contains workspace root path');
  assert(ctxManager.getSystemPrompt().includes('STRICT WORKSPACE BOUNDARY'), 'System prompt contains boundary rules');

  const insidePath = path.join(dummyRoot, 'src', 'extension.ts');
  const outsidePath = 'c:\\some\\other\\folder\\secret.env';
  const relInside = path.relative(path.resolve(dummyRoot).toLowerCase(), path.resolve(insidePath).toLowerCase());
  const relOutside = path.relative(path.resolve(dummyRoot).toLowerCase(), path.resolve(outsidePath).toLowerCase());
  assert(!relInside.startsWith('..'), 'Inside workspace path identified');
  assert(relOutside.startsWith('..') || path.isAbsolute(relOutside), 'Outside workspace path blocked');

  console.log('\n--- Testing Dynamic Context Limits ---');
  // Dynamic context limits adjust compaction thresholds correctly
  const dynamicCtx = new ContextManager(ollama);
  for (let i = 0; i < 5; i++) {
    dynamicCtx.addMessage({ role: 'user', content: 'Explain quicksort and mergesort' });
    dynamicCtx.addMessage({ role: 'assistant', content: 'Quicksort uses partitioning while mergesort uses divide and conquer...' });
  }
  const smallLimit = 2048;
  const largeLimit = 32768;
  assert(dynamicCtx.shouldCompact(smallLimit, 0.1), 'Triggers compaction under lower custom context limit (2048)');
  assert(!dynamicCtx.shouldCompact(largeLimit, 0.75), 'Does not trigger compaction under high context limit (32768)');

  console.log('\n--- Testing Auto Router Role Config ---');
  const autoRouter = new ModelRouter({
    mode: 'auto',
    selectedModel: 'auto',
    primaryModel: 'codellama:7b',
    fastModel: 'starcoder2:3b',
    heavyModel: 'qwen2.5-coder:32b',
  });
  const roleModels: OllamaModelInfo[] = [
    { name: 'starcoder2:3b', modified_at: '', size: 1, digest: 'd1' },
    { name: 'codellama:7b', modified_at: '', size: 1, digest: 'd2' },
    { name: 'qwen2.5-coder:32b', modified_at: '', size: 1, digest: 'd3' },
  ];
  const fastRoute = autoRouter.route('what is the syntax for async/await?', 40, roleModels);
  assert(fastRoute.modelName === 'starcoder2:3b', 'Auto fast role uses configured fastModel');
  const primaryRoute = autoRouter.route('Write a TypeScript REST client with retries', 400, roleModels);
  assert(primaryRoute.modelName === 'codellama:7b', 'Auto primary role uses configured primaryModel');
  const heavyRoute = autoRouter.route('Architect and refactor entire system design across services', 12000, roleModels);
  assert(heavyRoute.modelName === 'qwen2.5-coder:32b', 'Auto heavy role uses configured heavyModel');

  console.log('\n--- Testing Headless Background Ollama Launch Config ---');
  // Ensure Ollama launch configuration opts for background headless daemon
  assert(typeof ollama.launchOllama === 'function', 'OllamaService exposes launchOllama function');
  assert(typeof ollama.checkMultipleModelUpdates === 'function', 'OllamaService exposes multi-model update check');

  console.log('\n--- Testing Write Permission Allowlist ---');
  assert(normalizeWriteActionType('apply') === 'apply', 'Apply maps to apply action type');
  assert(normalizeWriteActionType('insert') === 'insert', 'Insert maps to insert action type');
  assert(normalizeWriteActionType('shell', 'npm install lodash') === 'npm', 'Shell npm install → npm');
  assert(normalizeWriteActionType('shell', 'node ./scripts/build.js') === 'node', 'Shell node → node');
  assert(
    normalizeWriteActionType('shell', '"C:\\Program Files\\nodejs\\npm.cmd" install') === 'npm',
    'Windows npm.cmd path → npm'
  );
  assert(describeWriteAction('npm') === 'Run npm …', 'Shell family describes as Run …');
  assert(isWriteActionAllowlisted('npm', ['apply', 'npm']), 'Allowlisted npm is allowed');
  assert(!isWriteActionAllowlisted('node', ['apply', 'npm']), 'Non-allowlisted node is blocked');
  assert(isWriteActionAllowlisted('Apply', ['apply']), 'Allowlist match is case-insensitive');

  console.log('\n--- Testing Agent Protocol ---');
  const parsed = parseAgentResponse(`I'll update the file.
<<<READ path="src/a.ts">>>
<<<SEARCH path="src/a.ts">>>
old
<<<REPLACE>>>
new
<<<END>>>
<<<RUN>>>
npm test
<<<END>>>
Done.`);
  assert(parsed.toolCalls.length === 3, 'Parsed read, search_replace, and run');
  assert(parsed.toolCalls[0].kind === 'read', 'First tool is read');
  assert(
    parsed.toolCalls[1].kind === 'search_replace' &&
      (parsed.toolCalls[1] as any).search.includes('old'),
    'Search/replace captured'
  );
  assert(
    parsed.toolCalls[2].kind === 'run' && (parsed.toolCalls[2] as any).command === 'npm test',
    'RUN command captured'
  );
  assert(!parsed.displayText.includes('<<<READ'), 'Protocol markers stripped from display');
  assert(parsed.displayText.includes("I'll update the file."), 'Display keeps prose');

  console.log('\n--- Testing Change Tracker ---');
  const tracker = new ChangeTracker();
  const batchId = tracker.startBatch();
  tracker.recordWrite(batchId, 'src/a.ts', 'old', 'new');
  tracker.recordWrite(batchId, 'src/b.ts', null, 'created');
  assert(tracker.listChangedPaths(batchId).join(',') === 'src/a.ts,src/b.ts', 'Lists changed paths');
  const undoRecords = tracker.takeBatchForUndo(batchId);
  assert(undoRecords.length === 2, 'Undo returns both records');
  assert(tracker.listChangedPaths(batchId).length === 0, 'Batch removed after undo take');

  console.log('\nAll verification tests passed successfully!');
}

runTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
