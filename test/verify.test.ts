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
import { modelNamesMatch, parseKeepAlive } from '../src/services/ollamaService';
import {
  describeWriteAction,
  isWriteActionAllowlisted,
  normalizeWriteActionType,
} from '../src/services/writePermissionPolicy';
import { parseAgentResponse, stripWrappingMarkdownFence, looksLikeWorkspaceTask, looksLikeChitchat, unwrapModelEnvelope, looksLikeProtocolNoise } from '../src/services/agentProtocol';
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

  console.log('\n--- Testing model keep-alive ---');
  assert(parseKeepAlive(undefined) === -1, 'Missing keep-alive stays loaded (-1)');
  assert(parseKeepAlive('-1') === -1, 'String -1 stays loaded');
  assert(parseKeepAlive('10m') === '10m', 'Duration strings are preserved');
  assert(parseKeepAlive('0') === 0, '0 unloads immediately');
  assert(modelNamesMatch('qwen2.5-coder:7b', 'qwen2.5-coder:7b'), 'Exact model names match');
  assert(modelNamesMatch('Qwen2.5-Coder:7b', 'qwen2.5-coder:7b'), 'Model name match is case-insensitive');
  assert(!modelNamesMatch('qwen2.5-coder:7b', 'qwen2.5-coder:1.5b'), 'Different size tags do not match');

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

  const fencedWrite = parseAgentResponse(`<<<WRITE path="src/app.css">>>
\`\`\`css
body { color: red; }
\`\`\`
<<<END>>>`);
  assert(fencedWrite.toolCalls.length === 1 && fencedWrite.toolCalls[0].kind === 'write', 'Fenced WRITE parsed');
  const cssBody = (fencedWrite.toolCalls[0] as any).content;
  assert(cssBody.includes('body { color: red; }'), 'WRITE keeps CSS source');
  assert(!cssBody.includes('```'), 'WRITE strips wrapping css fence');

  const fencedJs = parseAgentResponse(`<<<WRITE path="src/app.js">>>
\`\`\`javascript
console.log(1);
<<<END>>>`);
  const jsBody = (fencedJs.toolCalls[0] as any).content;
  assert(jsBody.trim() === 'console.log(1);', 'WRITE strips opening javascript fence without closer');
  assert(!jsBody.includes('```'), 'Unclosed javascript fence not written to file');

  const fencedHtmlReplace = parseAgentResponse(`<<<SEARCH path="index.html">>>
<title>Old</title>
<<<REPLACE>>>
\`\`\`html
<title>New</title>
\`\`\`
<<<END>>>`);
  const htmlReplace = (fencedHtmlReplace.toolCalls[0] as any).replace;
  assert(htmlReplace.trim() === '<title>New</title>', 'REPLACE strips wrapping html fence');

  const rawWrite = parseAgentResponse(`<<<WRITE path="src/ok.ts">>>
export const x = 1;
<<<END>>>`);
  assert((rawWrite.toolCalls[0] as any).content.includes('export const x = 1;'), 'Unfenced WRITE content unchanged');

  const trailingFence = parseAgentResponse(`<<<WRITE path="src/app.css">>>
body { color: red; }
\`\`\`
<<<END>>>`);
  const trailingBody = (trailingFence.toolCalls[0] as any).content;
  assert(trailingBody.includes('body { color: red; }'), 'WRITE keeps CSS when a fence is appended');
  assert(!trailingBody.includes('```'), 'WRITE strips trailing fence closer');

  const jsonInner = '<<<LIST path=".">>>\nI will inspect the workspace.';
  const jsonEnvelope = parseAgentResponse('```json\n' + JSON.stringify({ response: jsonInner }) + '\n```');
  assert(
    jsonEnvelope.toolCalls.length === 1 && jsonEnvelope.toolCalls[0].kind === 'list',
    'JSON envelope still parses LIST protocol'
  );
  assert(
    jsonEnvelope.displayText.includes('I will inspect the workspace.'),
    'JSON envelope shows inner assistant text'
  );
  assert(!jsonEnvelope.displayText.trim().startsWith('{'), 'JSON wrapper is not shown as the chat body');

  const unwrapped = unwrapModelEnvelope('{"response":"Hello from the model."}');
  assert(unwrapped === 'Hello from the model.', 'unwrapModelEnvelope extracts response string');

  const brokenJson =
    '{\n\n"response": "Please run the following command to remove all instances of \'``\' from the repo:\\n\\n<<<REPLACE path=".">>>\\nexact old text to find\\n``\\\\n\\nexact new text\\n\\\\n\\n<<<END>>>"\n\n}';
  let jsonParseFailed = false;
  try {
    JSON.parse(brokenJson);
  } catch {
    jsonParseFailed = true;
  }
  assert(jsonParseFailed, 'Pretty JSON with inner path quotes is not valid JSON');
  const unwrappedBroken = unwrapModelEnvelope(brokenJson);
  assert(
    unwrappedBroken.includes('Please run the following command'),
    'Loose JSON envelope extracts response despite inner path quotes'
  );
  assert(!unwrappedBroken.trim().startsWith('{'), 'Loose JSON unwrap drops the wrapper object');
  const parsedBroken = parseAgentResponse(brokenJson);
  assert(parsedBroken.toolCalls.length === 0, 'REPLACE path="." is not executed as a workspace edit');
  assert(!parsedBroken.displayText.includes('"response"'), 'Broken JSON wrapper is not shown as chat');
  assert(!parsedBroken.displayText.includes('<<<REPLACE'), 'Invalid REPLACE tag is stripped from display');

  const mdKeep = stripWrappingMarkdownFence('```bash\necho hi\n```\n', 'README.md');
  assert(mdKeep.includes('```bash'), 'Markdown file keeps intentional bash fence');

  const mdUnwrap = stripWrappingMarkdownFence('```markdown\n# Title\n```\n', 'README.md');
  assert(mdUnwrap.includes('# Title'), 'Wrapped markdown document unwraps');
  assert(!mdUnwrap.includes('```markdown'), 'Outer markdown fence stripped');

  assert(looksLikeWorkspaceTask('Fix the ```css in this repo'), 'Fence-fix prompt is a workspace task');
  assert(looksLikeWorkspaceTask('Improve this app'), 'Improve-app prompt is a workspace task');
  assert(looksLikeWorkspaceTask('Remove comments from this repo'), 'Remove-comments prompt is a workspace task');
  assert(looksLikeWorkspaceTask('audit this repo for syntax errors'), 'Audit prompt is a workspace task');
  assert(looksLikeWorkspaceTask('Remove all instances of "```" from this repo'), 'Remove-fences prompt is a workspace task');
  assert(!looksLikeWorkspaceTask('what is the syntax for a typescript interface?'), 'Trivia question is not a workspace task');
  assert(looksLikeChitchat('Hello?'), 'Hello? is chitchat');
  assert(looksLikeChitchat('hi'), 'hi is chitchat');
  assert(!looksLikeChitchat('Hello, please fix the CSS'), 'Request after greeting is not chitchat');
  assert(!looksLikeWorkspaceTask('Hello?'), 'Hello? is not a workspace task');

  const backtickList = parseAgentResponse('``LIST path="src/styles.css"``');
  assert(
    backtickList.toolCalls.length === 1 && backtickList.toolCalls[0].kind === 'read',
    'Double-backtick LIST of a file becomes READ'
  );
  assert(
    (backtickList.toolCalls[0] as any).path === 'src/styles.css',
    'Backtick LIST keeps the file path'
  );
  assert(!backtickList.displayText.includes('LIST'), 'Backtick LIST is not shown as chat text');
  assert(looksLikeProtocolNoise('``LIST path="src/styles.css"``'), 'Raw backtick LIST is protocol noise');

  const backtickListRoot = parseAgentResponse('``LIST path="."``');
  assert(
    backtickListRoot.toolCalls.length === 1 && backtickListRoot.toolCalls[0].kind === 'list',
    'Double-backtick LIST of . stays LIST'
  );

  const singleTickList = parseAgentResponse('`LIST path="src/app.ts"`');
  assert(
    singleTickList.toolCalls.length === 1 && (singleTickList.toolCalls[0] as any).path === 'src/app.ts',
    'Single-backtick LIST is recovered'
  );

  const fencedList = parseAgentResponse('```\nLIST path="src/styles.css"\n```');
  assert(
    fencedList.toolCalls.length === 1 && fencedList.toolCalls[0].kind === 'read',
    'Fenced LIST path= line is recovered'
  );

  const xmlList = parseAgentResponse('<LIST path="src/styles.css" />');
  assert(
    xmlList.toolCalls.length === 1 && xmlList.toolCalls[0].kind === 'read',
    'XML LIST tag is recovered'
  );

  const jsonTool = parseAgentResponse(JSON.stringify({ tool: 'list', path: 'src/styles.css' }));
  assert(
    jsonTool.toolCalls.length === 1 && jsonTool.toolCalls[0].kind === 'read',
    'JSON tool envelope LIST of a file becomes READ'
  );

  const squareList = parseAgentResponse('[[LIST path="src/a.ts"]]');
  assert(
    squareList.toolCalls.length === 1 && squareList.toolCalls[0].kind === 'read',
    'Square-bracket LIST is recovered'
  );

  const unquoted = parseAgentResponse('<<<LIST path=src/a.ts>>>');
  assert(
    unquoted.toolCalls.length === 1 && (unquoted.toolCalls[0] as any).path === 'src/a.ts',
    'Unquoted path in LIST is recovered'
  );

  const singleQuoted = parseAgentResponse("<<<READ path='src/a.ts'>>>");
  assert(
    singleQuoted.toolCalls.length === 1 && (singleQuoted.toolCalls[0] as any).path === 'src/a.ts',
    'Single-quoted READ path is recovered'
  );

  const fnList = parseAgentResponse('LIST("src/a.ts")');
  assert(
    fnList.toolCalls.length === 1 && fnList.toolCalls[0].kind === 'read',
    'LIST("path") function form is recovered'
  );

  const twoAngle = parseAgentResponse('<<LIST path="src/a.ts">>');
  assert(
    twoAngle.toolCalls.length === 1 && twoAngle.toolCalls[0].kind === 'read',
    'Two-angle LIST is recovered'
  );

  const backtickWrite = parseAgentResponse(
    '``WRITE path="src/app.css"``\nbody { color: red; }\n``END``'
  );
  assert(
    backtickWrite.toolCalls.length === 1 && backtickWrite.toolCalls[0].kind === 'write',
    'Backtick WRITE/END is recovered'
  );
  assert(
    (backtickWrite.toolCalls[0] as any).content.includes('body { color: red; }'),
    'Backtick WRITE keeps CSS body'
  );
  assert(!backtickWrite.displayText.includes('WRITE'), 'Backtick WRITE is not shown as chat text');

  const backtickSearch = parseAgentResponse(
    '``SEARCH path="src/a.ts"``\nold\n``REPLACE``\nnew\n``END``'
  );
  assert(
    backtickSearch.toolCalls.length === 1 && backtickSearch.toolCalls[0].kind === 'search_replace',
    'Backtick SEARCH/REPLACE is recovered'
  );

  const backtickRun = parseAgentResponse('``RUN``\nnpm test\n``END``');
  assert(
    backtickRun.toolCalls.length === 1 &&
      backtickRun.toolCalls[0].kind === 'run' &&
      (backtickRun.toolCalls[0] as any).command === 'npm test',
    'Backtick RUN/END is recovered'
  );

  const jsonReadFile = parseAgentResponse(
    JSON.stringify({ name: 'read_file', arguments: { path: 'src/a.ts' } })
  );
  assert(
    jsonReadFile.toolCalls.length === 1 &&
      jsonReadFile.toolCalls[0].kind === 'read' &&
      (jsonReadFile.toolCalls[0] as any).path === 'src/a.ts',
    'JSON read_file alias is recovered'
  );

  const unclosedWrite = parseAgentResponse('<<<WRITE path="src/ok.ts">>>\nexport const x = 1;\n```');
  assert(
    unclosedWrite.toolCalls.length === 1 && unclosedWrite.toolCalls[0].kind === 'write',
    'WRITE missing END still parses when a fence closer is used'
  );
  assert((unclosedWrite.toolCalls[0] as any).content.includes('export const x = 1;'), 'Unclosed WRITE keeps source');

  const canonicalStillWorks = parseAgentResponse('<<<LIST path=".">>>\nI will inspect the workspace.');
  assert(
    canonicalStillWorks.toolCalls.length === 1 && canonicalStillWorks.toolCalls[0].kind === 'list',
    'Canonical <<<LIST>>> still parses after normalizer'
  );
  assert(
    canonicalStillWorks.displayText.includes('I will inspect the workspace.'),
    'Canonical LIST still keeps surrounding prose'
  );

  const promptText = ctxManager.getSystemPrompt();
  assert(!promptText.includes('```css'), 'System prompt does not name css fences (avoids 7b refusals)');
  assert(!promptText.includes('```javascript'), 'System prompt does not name javascript fences');
  assert(promptText.includes('Do not ask the user'), 'System prompt tells the model not to stall for details');

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
