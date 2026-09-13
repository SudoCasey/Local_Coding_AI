declare function acquireVsCodeApi(): {
  postMessage: (message: any) => void;
  getState: () => any;
  setState: (state: any) => void;
};

const vscode = acquireVsCodeApi();

interface Attachment {
  name: string;
  content: string;
}

let isGenerating = false;
let currentAssistantMessageEl: HTMLElement | null = null;
let currentAssistantText = '';
let markdownRenderTimer: number | null = null;
const attachments: Attachment[] = [];

// DOM Elements
const modelSelect = document.getElementById('model-select') as HTMLSelectElement;
const writePermSelect = document.getElementById('write-perm-select') as HTMLSelectElement;
const btnManageAllowlist = document.getElementById('btn-manage-allowlist') as HTMLButtonElement;
const writeAllowlistCount = document.getElementById('write-allowlist-count') as HTMLSpanElement;
const btnCheckUpdates = document.getElementById('btn-check-updates') as HTMLButtonElement;
const btnAddModel = document.getElementById('btn-add-model') as HTMLButtonElement;
const btnToggleSide = document.getElementById('btn-toggle-side') as HTMLButtonElement;
const pullModelPanel = document.getElementById('pull-model-panel') as HTMLDivElement;
const pullModelSelect = document.getElementById('pull-model-select') as HTMLSelectElement;
const customModelInputWrapper = document.getElementById('custom-model-input-wrapper') as HTMLDivElement;
const pullModelInput = document.getElementById('pull-model-input') as HTMLInputElement;
const btnPullSubmit = document.getElementById('btn-pull-submit') as HTMLButtonElement;
const downloadsContainer = document.getElementById('downloads-container') as HTMLDivElement;

const autoRouterPanel = document.getElementById('auto-router-panel') as HTMLDivElement;
const autoFastSelect = document.getElementById('auto-fast-select') as HTMLSelectElement;
const autoPrimarySelect = document.getElementById('auto-primary-select') as HTMLSelectElement;
const autoHeavySelect = document.getElementById('auto-heavy-select') as HTMLSelectElement;
const autoExtraSelect = document.getElementById('auto-extra-select') as HTMLSelectElement;

const SUGGESTED_AUTO_MODELS = [
  'qwen2.5-coder:1.5b',
  'qwen2.5-coder:3b',
  'qwen2.5-coder:7b',
  'qwen2.5-coder:14b',
  'qwen2.5-coder:32b',
  'deepseek-coder-v2:16b',
  'codellama:7b',
  'codellama:13b',
  'starcoder2:3b',
  'starcoder2:7b',
  'llama3.1:8b',
  'mistral:7b',
];

let latestInstalledModels: string[] = [];
let latestAutoConfig = {
  fastModel: 'qwen2.5-coder:1.5b',
  primaryModel: 'qwen2.5-coder:7b',
  heavyModel: 'qwen2.5-coder:14b',
};

const btnLaunchOllama = document.getElementById('btn-launch-ollama') as HTMLButtonElement;
const btnLaunchBanner = document.getElementById('btn-launch-banner') as HTMLButtonElement;
const ollamaOfflineBanner = document.getElementById('ollama-offline-banner') as HTMLDivElement;

const activeDownloads = new Map<string, HTMLElement>();

const vramDot = document.getElementById('vram-dot') as HTMLSpanElement;
const vramText = document.getElementById('vram-text') as HTMLSpanElement;
const contextUsedText = document.getElementById('context-used-text') as HTMLSpanElement;
const contextLimitSelect = document.getElementById('context-limit-select') as HTMLSelectElement;

const btnFreeVram = document.getElementById('btn-free-vram') as HTMLButtonElement;
const btnCompactContext = document.getElementById('btn-compact-context') as HTMLButtonElement;
const btnClearContext = document.getElementById('btn-clear-context') as HTMLButtonElement;
const btnFreeRam = document.getElementById('btn-free-ram') as HTMLButtonElement;

const chatContainer = document.getElementById('chat-messages') as HTMLElement;
const attachmentChipsContainer = document.getElementById('attachment-chips') as HTMLDivElement;
const btnAttachFile = document.getElementById('btn-attach-file') as HTMLButtonElement;
const btnAttachSelection = document.getElementById('btn-attach-selection') as HTMLButtonElement;

const promptInput = document.getElementById('prompt-input') as HTMLTextAreaElement;
const btnSend = document.getElementById('btn-send') as HTMLButtonElement;
const btnStop = document.getElementById('btn-stop') as HTMLButtonElement;

let stickToBottom = true;
let isAutoScrolling = false;

chatContainer.addEventListener('scroll', () => {
  if (isAutoScrolling) {
    return;
  }
  const gap =
    chatContainer.scrollHeight - chatContainer.scrollTop - chatContainer.clientHeight;
  stickToBottom = gap < 72;
});

// Event Listeners
modelSelect.addEventListener('change', () => {
  const selected = modelSelect.value;
  toggleAutoPanel(selected === 'auto');
  vscode.postMessage({
    type: 'selectModel',
    payload: { model: selected },
  });
});

writePermSelect?.addEventListener('change', () => {
  vscode.postMessage({
    type: 'setWritePermissionMode',
    payload: { mode: writePermSelect.value },
  });
});

btnManageAllowlist?.addEventListener('click', () => {
  vscode.postMessage({ type: 'manageWritePermissions' });
});

function applyWritePermissionState(mode?: string, allowlist?: string[]): void {
  if (writePermSelect && (mode === 'allowlist' || mode === 'runEverything')) {
    writePermSelect.value = mode;
  }
  if (writeAllowlistCount) {
    const count = Array.isArray(allowlist) ? allowlist.length : 0;
    writeAllowlistCount.textContent = String(count);
    writeAllowlistCount.title =
      count === 0
        ? 'No allowlisted action types yet'
        : `Allowlisted: ${allowlist!.join(', ')}`;
  }
}

function toggleAutoPanel(show: boolean) {
  if (!autoRouterPanel) return;
  if (show) {
    autoRouterPanel.classList.remove('hidden');
  } else {
    autoRouterPanel.classList.add('hidden');
  }
}

function modelIsInstalled(name: string, installed: string[]): boolean {
  const targetLower = name.toLowerCase();
  if (installed.some((n) => n.toLowerCase() === targetLower)) {
    return true;
  }
  const baseTarget = targetLower.split(':')[0];
  const tag = targetLower.includes(':') ? targetLower.split(':')[1] : undefined;
  return installed.some((n) => {
    const nl = n.toLowerCase();
    if (!nl.startsWith(baseTarget)) return false;
    if (!tag) return true;
    return nl.includes(tag);
  });
}

function populateAutoRoleSelect(
  selectEl: HTMLSelectElement | null,
  selected: string,
  installed: string[]
) {
  if (!selectEl) return;
  const options = new Set<string>([...installed, ...SUGGESTED_AUTO_MODELS, selected]);
  selectEl.innerHTML = '';
  [...options]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))
    .forEach((name) => {
      const opt = document.createElement('option');
      opt.value = name;
      const missing = !modelIsInstalled(name, installed);
      opt.textContent = missing ? `${name} (not installed)` : name;
      selectEl.appendChild(opt);
    });
  selectEl.value = selected;
  if (!Array.from(selectEl.options).some((o) => o.value === selected)) {
    const opt = document.createElement('option');
    opt.value = selected;
    opt.textContent = `${selected} (not installed)`;
    selectEl.appendChild(opt);
    selectEl.value = selected;
  }
  const missingSelected = !modelIsInstalled(selected, installed);
  selectEl.classList.toggle('missing', missingSelected);
  const row = selectEl.closest('.auto-role-row');
  const dlBtn = row?.querySelector('.auto-role-dl') as HTMLButtonElement | null;
  if (dlBtn) {
    dlBtn.classList.toggle('needed', missingSelected);
    dlBtn.title = missingSelected
      ? `Download missing model: ${selected}`
      : `Re-pull / update ${selected}`;
  }
}

function applyAutoConfig(autoConfig: any, installedNames?: string[]) {
  if (!autoConfig) return;
  latestAutoConfig = {
    fastModel: autoConfig.fastModel || latestAutoConfig.fastModel,
    primaryModel: autoConfig.primaryModel || latestAutoConfig.primaryModel,
    heavyModel: autoConfig.heavyModel || latestAutoConfig.heavyModel,
  };
  if (Array.isArray(installedNames)) {
    latestInstalledModels = installedNames;
  } else if (Array.isArray(autoConfig.installedNames)) {
    latestInstalledModels = autoConfig.installedNames;
  }
  populateAutoRoleSelect(autoFastSelect, latestAutoConfig.fastModel, latestInstalledModels);
  populateAutoRoleSelect(autoPrimarySelect, latestAutoConfig.primaryModel, latestInstalledModels);
  populateAutoRoleSelect(autoHeavySelect, latestAutoConfig.heavyModel, latestInstalledModels);
  toggleAutoPanel(modelSelect.value === 'auto');
}

function bindAutoRoleSelect(selectEl: HTMLSelectElement | null, role: string) {
  selectEl?.addEventListener('change', () => {
    vscode.postMessage({
      type: 'setAutoModelRole',
      payload: { role, modelName: selectEl.value },
    });
  });
}

bindAutoRoleSelect(autoFastSelect, 'fast');
bindAutoRoleSelect(autoPrimarySelect, 'primary');
bindAutoRoleSelect(autoHeavySelect, 'heavy');

document.querySelectorAll('.auto-role-dl').forEach((btn) => {
  btn.addEventListener('click', () => {
    const role = (btn as HTMLElement).getAttribute('data-role') || 'primary';
    const select =
      role === 'fast' ? autoFastSelect : role === 'heavy' ? autoHeavySelect : autoPrimarySelect;
    const modelName = select?.value;
    if (!modelName) return;
    vscode.postMessage({
      type: 'downloadAutoRoleModel',
      payload: { role, modelName },
    });
  });
});

autoExtraSelect?.addEventListener('change', () => {
  const val = autoExtraSelect.value;
  if (!val || !val.includes('|')) return;
  const [role, modelName] = val.split('|');
  vscode.postMessage({
    type: 'downloadAutoRoleModel',
    payload: { role, modelName },
  });
  autoExtraSelect.selectedIndex = 0;
});

contextLimitSelect?.addEventListener('change', () => {
  const val = contextLimitSelect.value;
  if (val === 'custom') {
    vscode.postMessage({ type: 'promptCustomContextLimit' });
  } else {
    const num = parseInt(val, 10);
    if (!isNaN(num) && num > 0) {
      vscode.postMessage({
        type: 'setContextLimit',
        payload: { contextWindow: num },
      });
    }
  }
});

btnCheckUpdates.addEventListener('click', () => {
  vscode.postMessage({
    type: 'checkModelUpdates',
    payload: { modelName: modelSelect.value },
  });
});

btnAddModel.addEventListener('click', () => {
  pullModelPanel.classList.toggle('hidden');
  if (!pullModelPanel.classList.contains('hidden')) {
    pullModelSelect.focus();
  }
});

pullModelSelect?.addEventListener('change', () => {
  if (pullModelSelect.value === 'custom') {
    customModelInputWrapper.classList.remove('hidden');
    pullModelInput.focus();
  } else {
    customModelInputWrapper.classList.add('hidden');
    pullModelInput.value = pullModelSelect.value;
  }
});

btnToggleSide?.addEventListener('click', () => {
  vscode.postMessage({ type: 'toggleSidebarPosition' });
});

btnPullSubmit.addEventListener('click', () => {
  let modelName = '';
  if (pullModelSelect.value === 'custom') {
    modelName = pullModelInput.value.trim();
  } else if (pullModelSelect.value) {
    modelName = pullModelSelect.value.trim();
  } else {
    modelName = pullModelInput.value.trim();
  }

  if (modelName) {
    vscode.postMessage({
      type: 'pullModel',
      payload: { modelName },
    });
    pullModelInput.value = '';
    pullModelSelect.selectedIndex = 0;
    customModelInputWrapper.classList.add('hidden');
    pullModelPanel.classList.add('hidden');
  }
});

pullModelInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    btnPullSubmit.click();
  }
});

const triggerLaunchOllama = () => {
  if (btnLaunchOllama) {
    btnLaunchOllama.disabled = true;
    btnLaunchOllama.textContent = '⏳ Starting...';
  }
  if (btnLaunchBanner) {
    btnLaunchBanner.disabled = true;
    btnLaunchBanner.textContent = '⏳ Starting...';
  }
  vscode.postMessage({ type: 'launchOllama' });
};

btnLaunchOllama?.addEventListener('click', triggerLaunchOllama);
btnLaunchBanner?.addEventListener('click', triggerLaunchOllama);

btnFreeVram.addEventListener('click', () => {
  vscode.postMessage({ type: 'freeVram' });
});

btnCompactContext.addEventListener('click', () => {
  vscode.postMessage({ type: 'compactContext' });
});

btnClearContext.addEventListener('click', () => {
  vscode.postMessage({ type: 'clearContext' });
});

btnFreeRam.addEventListener('click', () => {
  vscode.postMessage({ type: 'freeRam' });
});

btnAttachFile.addEventListener('click', () => {
  vscode.postMessage({ type: 'attachActiveFile' });
});

btnAttachSelection.addEventListener('click', () => {
  vscode.postMessage({ type: 'attachSelection' });
});

btnSend.addEventListener('click', () => {
  sendMessage();
});

btnStop.addEventListener('click', () => {
  vscode.postMessage({ type: 'stopGeneration' });
  setGeneratingState(false);
});

promptInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

promptInput.addEventListener('input', () => {
  promptInput.style.height = 'auto';
  promptInput.style.height = Math.min(promptInput.scrollHeight, 150) + 'px';
});

// Setup prompt chip listeners
document.querySelectorAll('.prompt-chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    const prompt = (chip as HTMLElement).dataset.prompt;
    if (prompt) {
      promptInput.value = prompt;
      sendMessage();
    }
  });
});

function sendMessage(): void {
  const text = promptInput.value.trim();
  if (!text && attachments.length === 0) return;
  if (isGenerating) return;

  // Append User Bubble
  appendUserMessage(text, [...attachments]);

  const payloadAttachments = attachments.map((a) => a.content);
  attachments.length = 0;
  renderAttachments();

  promptInput.value = '';
  promptInput.style.height = 'auto';

  setGeneratingState(true);

  // Prepare Assistant Placeholder Bubble
  currentAssistantText = '';
  currentAssistantMessageEl = createAssistantMessageElement();
  chatContainer.appendChild(currentAssistantMessageEl);
  pinChatToBottom();

  vscode.postMessage({
    type: 'sendMessage',
    payload: {
      prompt: text,
      contextAttachments: payloadAttachments,
    },
  });
}

function setGeneratingState(generating: boolean): void {
  isGenerating = generating;
  if (generating) {
    btnSend.classList.add('hidden');
    btnStop.classList.remove('hidden');
  } else {
    btnSend.classList.remove('hidden');
    btnStop.classList.add('hidden');
  }
}

function appendUserMessage(text: string, attached: Attachment[]): void {
  removeWelcomeBox();

  const msgDiv = document.createElement('div');
  msgDiv.className = 'message user';

  const header = document.createElement('div');
  header.className = 'message-header';
  header.textContent = 'You';
  msgDiv.appendChild(header);

  if (attached.length > 0) {
    const attachMeta = document.createElement('div');
    attachMeta.style.fontSize = '11px';
    attachMeta.style.color = 'var(--fg-secondary)';
    attachMeta.style.marginBottom = '4px';
    attachMeta.textContent = `Attached: ${attached.map((a) => a.name).join(', ')}`;
    msgDiv.appendChild(attachMeta);
  }

  const body = document.createElement('div');
  body.className = 'message-body';
  body.textContent = text;
  msgDiv.appendChild(body);

  chatContainer.appendChild(msgDiv);
  pinChatToBottom();
}

function createAssistantMessageElement(): HTMLElement {
  removeWelcomeBox();

  const msgDiv = document.createElement('div');
  msgDiv.className = 'message assistant';

  const header = document.createElement('div');
  header.className = 'message-header';
  header.innerHTML = `<span>Assistant</span> <span class="model-tag" id="active-model-tag">Thinking...</span>`;
  msgDiv.appendChild(header);

  const body = document.createElement('div');
  body.className = 'message-body';
  body.innerHTML = '<em>Connecting to local model...</em>';
  msgDiv.appendChild(body);

  return msgDiv;
}

function removeWelcomeBox(): void {
  const welcome = chatContainer.querySelector('.welcome-box');
  if (welcome) {
    welcome.remove();
  }
}

function pinChatToBottom(): void {
  stickToBottom = true;
  scrollToBottom();
}

function scrollToBottom(): void {
  if (!stickToBottom) {
    return;
  }
  isAutoScrolling = true;
  chatContainer.scrollTop = chatContainer.scrollHeight;
  requestAnimationFrame(() => {
    isAutoScrolling = false;
  });
}

function flushMarkdownRender(): void {
  if (markdownRenderTimer !== null) {
    window.clearTimeout(markdownRenderTimer);
    markdownRenderTimer = null;
  }
  if (currentAssistantMessageEl) {
    const body = currentAssistantMessageEl.querySelector('.message-body');
    if (body) {
      body.innerHTML = renderMarkdown(currentAssistantText);
    }
  }
  scrollToBottom();
}

function scheduleMarkdownRender(): void {
  if (markdownRenderTimer !== null) {
    return;
  }
  markdownRenderTimer = window.setTimeout(() => {
    markdownRenderTimer = null;
    flushMarkdownRender();
  }, 50);
}

function renderAttachments(): void {
  attachmentChipsContainer.innerHTML = '';
  attachments.forEach((att, idx) => {
    const chip = document.createElement('div');
    chip.className = 'chip';
    chip.innerHTML = `<span>${escapeHtml(att.name)}</span> <span class="chip-remove" data-idx="${idx}">&times;</span>`;
    chip.querySelector('.chip-remove')?.addEventListener('click', (e) => {
      const targetIdx = parseInt((e.target as HTMLElement).dataset.idx || '0', 10);
      attachments.splice(targetIdx, 1);
      renderAttachments();
    });
    attachmentChipsContainer.appendChild(chip);
  });
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 MB';
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) {
    return `${gb.toFixed(1)} GB`;
  }
  const mb = bytes / (1024 * 1024);
  return `${Math.round(mb)} MB`;
}

function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToUtf8(b64: string): string {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

// Markdown parser rendering HTML with interactive code blocks.
// Plain text is escaped before tags are added so model output cannot inject HTML.
function renderMarkdown(md: string): string {
  if (!md) return '';

  const codeBlocks: string[] = [];
  let processed = md.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (_match, lang, code) => {
    const placeholder = `__CODE_BLOCK_${codeBlocks.length}__`;
    codeBlocks.push(renderCodeBlock(lang || 'code', code));
    return `\n${placeholder}\n`;
  });

  processed = escapeHtml(processed);

  processed = processed.replace(/^### (.*$)/gim, '<h4>$1</h4>');
  processed = processed.replace(/^## (.*$)/gim, '<h3>$1</h3>');
  processed = processed.replace(/^# (.*$)/gim, '<h2>$1</h2>');
  processed = processed.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  processed = processed.replace(/\*(.*?)\*/g, '<em>$1</em>');
  processed = processed.replace(/`([^`]+)`/g, '<code>$1</code>');

  const lines = processed.split('\n');
  const renderedLines: string[] = [];
  let inList = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      if (!inList) {
        renderedLines.push('<ul>');
        inList = true;
      }
      renderedLines.push(`<li>${trimmed.substring(2)}</li>`);
    } else {
      if (inList) {
        renderedLines.push('</ul>');
        inList = false;
      }
      if (trimmed.length > 0) {
        if (trimmed.startsWith('__CODE_BLOCK_') || trimmed.startsWith('<h')) {
          renderedLines.push(trimmed);
        } else {
          renderedLines.push(`<p>${trimmed}</p>`);
        }
      }
    }
  }
  if (inList) {
    renderedLines.push('</ul>');
  }

  let finalHtml = renderedLines.join('\n');
  codeBlocks.forEach((blockHtml, idx) => {
    finalHtml = finalHtml.replace(`__CODE_BLOCK_${idx}__`, blockHtml);
  });

  return finalHtml;
}

function renderCodeBlock(lang: string, code: string): string {
  const escapedCode = escapeHtml(code.trimEnd());
  const rawBase64 = utf8ToBase64(code);

  return `
    <div class="code-block-container">
      <div class="code-header">
        <span class="code-lang">${escapeHtml(lang)}</span>
        <div class="code-actions">
          <button class="code-btn" data-action="copy" data-code="${rawBase64}">Copy</button>
          <button class="code-btn" data-action="insert" data-code="${rawBase64}">Insert</button>
        </div>
      </div>
      <pre><code class="language-${escapeHtml(lang)}">${escapedCode}</code></pre>
    </div>
  `;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Global click handler for code action buttons
document.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const btn = target.closest('.code-block-container .code-btn') as HTMLElement | null;
  if (!btn) return;
  const action = btn.dataset.action;
  const base64Code = btn.dataset.code;
  if (!base64Code) return;
  let code = '';
  try {
    code = base64ToUtf8(base64Code);
  } catch {
    return;
  }

  if (action === 'copy') {
    vscode.postMessage({ type: 'copyCode', payload: { code } });
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => (btn.textContent = orig), 1500);
  } else if (action === 'insert') {
    vscode.postMessage({ type: 'insertCodeAtCursor', payload: { code } });
  }
});

// Download Cards Management
function createDownloadCard(modelName: string): HTMLElement {
  const card = document.createElement('div');
  card.className = 'download-card';
  card.dataset.model = modelName;

  card.innerHTML = `
    <div class="download-card-header">
      <span class="download-model-name" title="${escapeHtml(modelName)}">${escapeHtml(modelName)}</span>
      <span class="download-percent">0%</span>
      <button class="download-cancel-btn" title="Cancel Download">&times;</button>
    </div>
    <div class="download-status-text">Starting download...</div>
    <div class="progress-bar">
      <div class="progress-fill" style="width: 0%;"></div>
    </div>
  `;

  const cancelBtn = card.querySelector('.download-cancel-btn') as HTMLButtonElement;
  cancelBtn?.addEventListener('click', () => {
    vscode.postMessage({
      type: 'cancelPullModel',
      payload: { modelName },
    });
    const statusEl = card.querySelector('.download-status-text');
    if (statusEl) statusEl.textContent = 'Cancelling...';
  });

  return card;
}

function updateDownloadCard(
  card: HTMLElement,
  modelName: string,
  status: string,
  percent?: number,
  total?: number,
  completed?: number
): void {
  const percentEl = card.querySelector('.download-percent') as HTMLElement;
  const statusEl = card.querySelector('.download-status-text') as HTMLElement;
  const fillEl = card.querySelector('.progress-fill') as HTMLElement;

  let displayStatus = status || 'Downloading...';
  if (typeof completed === 'number' && typeof total === 'number' && total > 0) {
    displayStatus = `${status} (${formatBytes(completed)} / ${formatBytes(total)})`;
  }
  if (statusEl) statusEl.textContent = displayStatus;

  if (typeof percent === 'number' && percent >= 0) {
    const clamped = Math.min(100, Math.max(0, percent));
    if (percentEl) percentEl.textContent = `${clamped}%`;
    if (fillEl) fillEl.style.width = `${clamped}%`;
  }
}

function markDownloadComplete(card: HTMLElement, modelName: string): void {
  card.classList.add('completed');
  const percentEl = card.querySelector('.download-percent') as HTMLElement;
  const statusEl = card.querySelector('.download-status-text') as HTMLElement;
  const fillEl = card.querySelector('.progress-fill') as HTMLElement;
  const cancelBtn = card.querySelector('.download-cancel-btn') as HTMLElement;

  if (percentEl) percentEl.textContent = '100%';
  if (fillEl) {
    fillEl.style.width = '100%';
    fillEl.style.backgroundColor = 'var(--status-green)';
  }
  if (statusEl) statusEl.textContent = 'Download complete!';
  if (cancelBtn) cancelBtn.remove();
}

function markDownloadFailed(card: HTMLElement, modelName: string, errMsg: string, cancelled?: boolean): void {
  card.classList.add('failed');
  const statusEl = card.querySelector('.download-status-text') as HTMLElement;
  const fillEl = card.querySelector('.progress-fill') as HTMLElement;
  const cancelBtn = card.querySelector('.download-cancel-btn') as HTMLElement;

  if (fillEl) {
    fillEl.style.backgroundColor = cancelled ? 'var(--status-yellow)' : 'var(--status-red)';
  }
  if (statusEl) {
    statusEl.textContent = cancelled ? 'Download cancelled' : `Failed: ${errMsg}`;
    statusEl.style.color = cancelled ? 'var(--status-yellow)' : 'var(--status-red)';
  }
  if (cancelBtn) {
    cancelBtn.title = 'Dismiss';
    cancelBtn.onclick = () => {
      card.remove();
      activeDownloads.delete(modelName);
    };
  }
}

// Extension Message Listener
window.addEventListener('message', (event) => {
  const message = event.data;

  switch (message.type) {
    case 'modelsList': {
      const { models, selectedModel, autoConfig, writePermissionMode, writeAllowlist } =
        message.payload;
      modelSelect.innerHTML = `<option value="auto">Auto Mode (Smart Router)</option>`;
      if (Array.isArray(models)) {
        latestInstalledModels = models.map((m: any) => m.name);
        models.forEach((m: any) => {
          const opt = document.createElement('option');
          opt.value = m.name;
          const paramSize = m.details?.parameter_size ? ` (${m.details.parameter_size})` : '';
          opt.textContent = `${m.name}${paramSize}`;
          modelSelect.appendChild(opt);
        });
      }
      if (selectedModel) {
        modelSelect.value = selectedModel;
      }
      applyAutoConfig(autoConfig || latestAutoConfig, latestInstalledModels);
      toggleAutoPanel(modelSelect.value === 'auto');
      applyWritePermissionState(writePermissionMode, writeAllowlist);
      break;
    }

    case 'writePermissionState': {
      applyWritePermissionState(message.payload?.mode, message.payload?.allowlist);
      break;
    }

    case 'autoConfig': {
      applyAutoConfig(message.payload);
      break;
    }

    case 'modelSelected': {
      const { selectedModel } = message.payload || {};
      if (selectedModel && modelSelect) {
        modelSelect.value = selectedModel;
      }
      toggleAutoPanel(modelSelect.value === 'auto');
      break;
    }

    case 'updateCheckResult': {
      const payload = message.payload || {};
      const results = Array.isArray(payload.results)
        ? payload.results
        : payload.modelName
          ? [payload]
          : [];
      if (results.length === 0) break;

      // Remove welcome box if present
      const welcome = chatContainer.querySelector('.welcome-box');
      if (welcome) {
        welcome.remove();
      }

      const wrap = document.createElement('div');
      wrap.className = 'message';
      wrap.innerHTML = `<div class="message-header"><strong>Model Update Check</strong></div>`;
      const body = document.createElement('div');
      body.className = 'message-body';

      results.forEach((res: any) => {
        const card = document.createElement('div');
        card.className = `update-card${res.hasUpdate ? ' has-update' : ''}`;
        const statusLabel = res.hasUpdate ? 'Update available' : 'Up to date / verified';
        const notes = res.changelog || res.description || '';
        card.innerHTML = `
          <div class="update-card-title">${escapeHtml(res.modelName)} — ${escapeHtml(statusLabel)}</div>
          <div class="update-card-meta">
            ${res.currentVersion ? `Version/tag: <strong>${escapeHtml(res.currentVersion)}</strong>` : ''}
            ${res.currentDetails ? `<br/>Local: ${escapeHtml(res.currentDetails)}` : ''}
            ${
              res.hasUpdate && res.latestVersion
                ? `<br/>Latest: <strong>${escapeHtml(res.latestVersion)}</strong>${
                    res.latestDetails ? ` · ${escapeHtml(res.latestDetails)}` : ''
                  }`
                : ''
            }
          </div>
          ${
            notes
              ? `<div class="update-card-notes"><strong>Notes:</strong> ${escapeHtml(notes)}</div>`
              : ''
          }
          <div class="update-card-actions">
            ${
              res.hasUpdate
                ? `<button class="primary" data-action="pull" data-model="${escapeHtml(res.modelName)}">Update Now</button>`
                : ''
            }
            ${
              res.libraryUrl
                ? `<button data-action="copy-link" data-url="${escapeHtml(res.libraryUrl)}">Copy Library Link</button>`
                : ''
            }
          </div>
        `;
        body.appendChild(card);
      });

      wrap.appendChild(body);
      chatContainer.appendChild(wrap);

      wrap.querySelectorAll('button[data-action="pull"]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const model = (btn as HTMLElement).getAttribute('data-model');
          if (model) {
            vscode.postMessage({ type: 'pullModel', payload: { modelName: model } });
          }
        });
      });
      wrap.querySelectorAll('button[data-action="copy-link"]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const url = (btn as HTMLElement).getAttribute('data-url') || '';
          vscode.postMessage({ type: 'copyCode', payload: { code: url } });
        });
      });
      scrollToBottom();
      break;
    }

    case 'statusUpdate': {
      const { isConnected, totalVramBytes, currentTokens, maxContext, error } = message.payload;
      if (isConnected) {
        vramDot.className = 'metric-dot green';
        vramText.textContent = `VRAM: ${formatBytes(totalVramBytes || 0)}`;
        if (typeof currentTokens === 'number') {
          const kTokens =
            currentTokens >= 1000
              ? `${(currentTokens / 1000).toFixed(currentTokens >= 10000 ? 0 : 1)}K`
              : `${currentTokens}`;
          if (contextUsedText) {
            contextUsedText.textContent = kTokens;
          }
        }
        if (typeof maxContext === 'number' && contextLimitSelect) {
          const strVal = maxContext.toString();
          const optionExists = Array.from(contextLimitSelect.options).some(
            (opt) => opt.value === strVal
          );
          if (!optionExists) {
            const customOpt = document.createElement('option');
            customOpt.value = strVal;
            const kMax = maxContext >= 1000 ? `${Math.round(maxContext / 1000)}K` : `${maxContext}`;
            customOpt.textContent = `${kMax} (${maxContext})`;
            contextLimitSelect.insertBefore(customOpt, contextLimitSelect.lastElementChild);
          }
          contextLimitSelect.value = strVal;
        }
        btnLaunchOllama?.classList.add('hidden');
        ollamaOfflineBanner?.classList.add('hidden');
      } else {
        vramDot.className = 'metric-dot red';
        vramText.textContent = 'Ollama Offline';
        if (error) {
          vramText.title = error;
        }
        btnLaunchOllama?.classList.remove('hidden');
        if (btnLaunchOllama) {
          btnLaunchOllama.disabled = false;
          btnLaunchOllama.textContent = '▶ Launch Ollama';
        }
        if (chatContainer.querySelector('.welcome-box')) {
          ollamaOfflineBanner?.classList.remove('hidden');
          if (btnLaunchBanner) {
            btnLaunchBanner.disabled = false;
            btnLaunchBanner.textContent = '▶ Launch Ollama';
          }
        }
      }
      break;
    }

    case 'ollamaLaunching': {
      const { status } = message.payload;
      if (status === 'launching') {
        if (btnLaunchOllama) {
          btnLaunchOllama.disabled = true;
          btnLaunchOllama.textContent = '⏳ Starting...';
        }
        if (btnLaunchBanner) {
          btnLaunchBanner.disabled = true;
          btnLaunchBanner.textContent = '⏳ Starting...';
        }
      } else if (status === 'success') {
        btnLaunchOllama?.classList.add('hidden');
        ollamaOfflineBanner?.classList.add('hidden');
      } else if (status === 'error') {
        if (btnLaunchOllama) {
          btnLaunchOllama.disabled = false;
          btnLaunchOllama.textContent = '▶ Retry Launch';
        }
        if (btnLaunchBanner) {
          btnLaunchBanner.disabled = false;
          btnLaunchBanner.textContent = '▶ Retry Launch';
        }
      }
      break;
    }

    case 'chunk': {
      if (message.payload.isStart) {
        if (!currentAssistantMessageEl) {
          currentAssistantText = '';
          currentAssistantMessageEl = createAssistantMessageElement();
          chatContainer.appendChild(currentAssistantMessageEl);
        }
        if (currentAssistantMessageEl) {
          const modelTag = currentAssistantMessageEl.querySelector('#active-model-tag');
          if (modelTag) {
            modelTag.textContent = message.payload.modelUsed || 'Thinking...';
            modelTag.setAttribute('title', message.payload.routingReason || '');
          }
          const body = currentAssistantMessageEl.querySelector('.message-body');
          if (body && !currentAssistantText) {
            const modelName = escapeHtml(message.payload.modelUsed || 'model');
            body.innerHTML = message.payload.modelAlreadyLoaded
              ? `<em>Thinking…</em>`
              : `<em>Loading ${modelName} into VRAM…</em>`;
          }
        }
      }

      if (message.payload.status && currentAssistantMessageEl) {
        const body = currentAssistantMessageEl.querySelector('.message-body');
        if (body && !currentAssistantText) {
          body.innerHTML = `<em>${escapeHtml(message.payload.status)}</em>`;
        } else {
          let statusEl = currentAssistantMessageEl.querySelector(
            '.agent-status-line'
          ) as HTMLElement | null;
          if (!statusEl) {
            statusEl = document.createElement('div');
            statusEl.className = 'agent-status-line';
            currentAssistantMessageEl.appendChild(statusEl);
          }
          statusEl.textContent = message.payload.status;
        }
      }

      if (message.payload.chunk) {
        currentAssistantText += message.payload.chunk;
        const statusEl = currentAssistantMessageEl?.querySelector('.agent-status-line');
        statusEl?.remove();
        scheduleMarkdownRender();
      }
      break;
    }

    case 'filesChanged': {
      const files: string[] = Array.isArray(message.payload?.files)
        ? message.payload.files
        : [];
      const batchId = String(message.payload?.batchId || '');
      if (files.length === 0 || !batchId) {
        break;
      }
      const card = document.createElement('div');
      card.className = 'files-changed-card';
      card.dataset.batchId = batchId;
      card.innerHTML = `
        <div class="files-changed-title">Files changed</div>
        <ul class="files-changed-list">
          ${files.map((f) => `<li><code>${escapeHtml(f)}</code></li>`).join('')}
        </ul>
        <button type="button" class="files-undo-btn" data-batch="${escapeHtml(batchId)}">
          Undo these changes
        </button>
      `;
      const undoBtn = card.querySelector('.files-undo-btn') as HTMLButtonElement;
      undoBtn?.addEventListener('click', () => {
        undoBtn.disabled = true;
        undoBtn.textContent = 'Undoing…';
        vscode.postMessage({
          type: 'undoFileChanges',
          payload: { batchId },
        });
      });
      chatContainer.appendChild(card);
      scrollToBottom();
      break;
    }

    case 'filesUndone': {
      const batchId = String(message.payload?.batchId || '');
      const card = chatContainer.querySelector(
        `.files-changed-card[data-batch-id="${batchId.replace(/"/g, '')}"]`
      ) as HTMLElement | null;
      if (card) {
        const restored: string[] = Array.isArray(message.payload?.restored)
          ? message.payload.restored
          : [];
        card.innerHTML = `<div class="files-changed-title">Undone</div>
          <ul class="files-changed-list">
            ${restored.map((f) => `<li><code>${escapeHtml(f)}</code></li>`).join('') || '<li>(none)</li>'}
          </ul>`;
        card.classList.add('undone');
      }
      break;
    }

    case 'complete': {
      flushMarkdownRender();
      setGeneratingState(false);
      currentAssistantMessageEl = null;
      scrollToBottom();
      break;
    }

    case 'error': {
      flushMarkdownRender();
      setGeneratingState(false);
      const errDiv = document.createElement('div');
      errDiv.className = 'message';
      errDiv.style.backgroundColor = 'rgba(248, 81, 73, 0.1)';
      errDiv.style.border = '1px solid var(--status-red)';
      errDiv.style.color = 'var(--status-red)';
      errDiv.innerHTML = `<strong>Error:</strong> ${escapeHtml(message.payload.message || 'Unknown error occurred')}`;
      chatContainer.appendChild(errDiv);
      scrollToBottom();
      break;
    }

    case 'pullProgress': {
      const { modelName, status, percent, total, completed } = message.payload;
      const targetModel = modelName || 'Model';
      let downloadEl = activeDownloads.get(targetModel);
      if (!downloadEl) {
        downloadEl = createDownloadCard(targetModel);
        downloadsContainer.appendChild(downloadEl);
        activeDownloads.set(targetModel, downloadEl);
      }
      updateDownloadCard(downloadEl, targetModel, status, percent, total, completed);
      break;
    }

    case 'pullComplete': {
      const { modelName } = message.payload;
      const targetModel = modelName || 'Model';
      const downloadEl = activeDownloads.get(targetModel);
      if (downloadEl) {
        markDownloadComplete(downloadEl, targetModel);
        setTimeout(() => {
          downloadEl.remove();
          activeDownloads.delete(targetModel);
        }, 4000);
      }
      break;
    }

    case 'pullError': {
      const { modelName, message: errMsg, cancelled } = message.payload;
      const targetModel = modelName || 'Model';
      let downloadEl = activeDownloads.get(targetModel);
      if (!downloadEl) {
        downloadEl = createDownloadCard(targetModel);
        downloadsContainer.appendChild(downloadEl);
        activeDownloads.set(targetModel, downloadEl);
      }
      markDownloadFailed(downloadEl, targetModel, errMsg || 'Download error', cancelled);
      break;
    }

    case 'contextCompacted': {
      const banner = document.createElement('div');
      banner.className = 'message compacted';
      banner.innerHTML = `
        <strong>Context Auto-Compacted</strong><br/>
        Tokens reduced from ${message.payload.originalTokens} to ${message.payload.newTokens}. Active task state preserved.
      `;
      chatContainer.appendChild(banner);
      scrollToBottom();
      break;
    }

    case 'contextCleared': {
      chatContainer.innerHTML = `
        <div class="welcome-box">
          <h3>Context Cleared</h3>
          <p>Conversation history and memory reset to 0 tokens. Ready for your next task!</p>
        </div>
      `;
      if (contextUsedText) {
        contextUsedText.textContent = '0';
      }
      break;
    }

    case 'vramFreed': {
      vramText.textContent = 'VRAM: 0 MB';
      break;
    }

    case 'ramFreed': {
      // Confirmation
      break;
    }

    case 'contextAttached': {
      attachments.push({
        name: message.payload.name,
        content: message.payload.content,
      });
      renderAttachments();
      break;
    }
  }
});
