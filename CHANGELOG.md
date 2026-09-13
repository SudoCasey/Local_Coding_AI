# Changelog

All notable changes to **Local Coding AI** are documented here.
Released builds are published as `local-coding-ai-X.X.X.vsix` on
[GitHub Releases](https://github.com/SudoCasey/Local_Coding_AI/releases).

## [0.3.4] — 2026-09-13

### Summary

Switching from 1.5B to 7B waits until the smaller model is actually unloaded.
JSON-wrapped replies are unwrapped so file edits apply. Trailing markdown
fences are stripped from writes, and the chat sidebar no longer jumps to the
bottom while you are scrolled up.

### Changes

- Unload a loaded 1.5B runner and wait until it leaves VRAM before loading 7B
- Unwrap JSON / json-code-block envelopes so LIST/READ/WRITE still run
- Strip leftover fence closer lines at the end of non-markdown file writes
- Keep the chat scroll position when the user has scrolled up during streaming

**Download:** [local-coding-ai-0.3.4.vsix](https://github.com/SudoCasey/Local_Coding_AI/releases/download/v0.3.4/local-coding-ai-0.3.4.vsix)

## [0.3.3] — 2026-09-13

### Summary

The current chat model stays in VRAM between prompts. It is unloaded only
when you click Free VRAM, when the selected model changes, or when VS Code
closes.

### Changes

- Keep the loaded model in VRAM after each prompt (`keep_alive: -1` by default)
- Unload other runners only when switching models, not on every request
- Compaction uses the current chat model so a fast model does not evict it
- Status shows “Thinking…” when the model is already loaded

**Download:** [local-coding-ai-0.3.3.vsix](https://github.com/SudoCasey/Local_Coding_AI/releases/download/v0.3.3/local-coding-ai-0.3.3.vsix)

## [0.3.2] — 2026-09-13

### Summary

The assistant acts on the open workspace instead of refusing or asking for
more details. Wrapping markdown fences are still stripped from file writes.

### Changes

- Stop 7B refusals caused by naming markdown fence tokens in the system prompt
- Instruct the model to LIST/READ the workspace and apply edits, not stall
- Attach a workspace file index to project requests
- If the first reply has no tools, nudge the model to inspect and edit
- Keep stripping wrapping markdown fences from WRITE and REPLACE bodies

**Download:** [local-coding-ai-0.3.2.vsix](https://github.com/SudoCasey/Local_Coding_AI/releases/download/v0.3.2/local-coding-ai-0.3.2.vsix)

## [0.3.1] — 2026-09-13

### Summary

File edits from the assistant stay valid source. Markdown fences such as
` ```css `, ` ```javascript `, and ` ```html ` are no longer written into
files. Packaged `.vsix` builds are kept in the repository root for local
install during development.

### Changes

- Strip wrapping markdown code fences from WRITE and SEARCH/REPLACE bodies
- Instruct the model to emit raw file contents (no language-tagged fences)
- READ tool results no longer wrap file text in markdown fences
- Keep the packaged `local-coding-ai-X.X.X.vsix` in the repository root

**Download:** [local-coding-ai-0.3.1.vsix](https://github.com/SudoCasey/Local_Coding_AI/releases/download/v0.3.1/local-coding-ai-0.3.1.vsix)

## [0.3.0] — 2026-09-13

### Summary

The assistant can read and edit multiple workspace files itself (no Allowlist for
writing code), then list changed files with Undo. Command execution (`npm`,
`git`, `node`, …) still requires Allowlist approval.

### Changes

- Agentic multi-file edits via READ / LIST / SEARCH+REPLACE / WRITE protocol
- File writes apply automatically inside the workspace (no Allowlist prompts)
- Per-prompt **Files changed** card with **Undo these changes**
- `<<<RUN>>>` command execution stays Allowlist-gated (`npm`, `git`, `node`, …)
- Removed per-block **Apply to File** buttons (Copy / Insert remain)
- Sidebar control renamed to **AI execution** (writing vs running)

**Download:** [local-coding-ai-0.3.0.vsix](https://github.com/SudoCasey/Local_Coding_AI/releases/download/v0.3.0/local-coding-ai-0.3.0.vsix)

## [0.2.0] — 2026-09-13


### Summary

Adds Allowlist / Run everything write-permission modes so users control whether
Apply, Insert, and similar write action types need approval — with one-shot Run
or persistent Add to Allowlist.

### Changes

- New setting `localCodingAI.writePermissionMode`: **Allowlist** (default) or **Run everything**
- Allowlist mode prompts before write actions (`apply`, `insert`, and shell families like `npm` / `node`)
  - **Run** — allow once; ask again next time for that action type
  - **Add to Allowlist** — remember the action type so future runs skip the prompt
- Run everything mode skips write-permission prompts
- Persist allowlisted types in `localCodingAI.writeAllowlist`
- Sidebar **AI writes** control + manage-allowlist button / command
- Apply shows a diff preview when approval is still required
- Extension author metadata: **Casey Friedrich** ([cfriedrich.net](https://cfriedrich.net))

**Download:** [local-coding-ai-0.2.0.vsix](https://github.com/SudoCasey/Local_Coding_AI/releases/download/v0.2.0/local-coding-ai-0.2.0.vsix)

## [0.1.1] — 2026-09-13


### Summary

Fixes Windows Ollama reliability: larger models (such as 7B) no longer hang on
“Connecting…”, and CMD windows no longer flash when VS Code opens or Ollama
starts. Also hardens security around remote URLs and workspace file tools.

### Changes

- Prefer launching the Ollama tray app (`ollama app.exe`) on Windows instead of a
  hidden `ollama.exe serve`, so GPU runners can load larger models correctly
- Avoid startup `/api/tags` and `/api/ps` probes that spawned flashing console
  runners when VS Code opened
- Show “Loading … into VRAM…” status while a model starts; time out with a clear
  error instead of spinning forever
- Unload other loaded runners before switching models so a stuck 1.5B process
  cannot block 7B
- Require confirmation before using a non-loopback `ollamaUrl`
- Fail closed on attach/apply when no workspace folder is open
- Escape model HTML in the chat webview; confirm Apply with a diff preview
- Bind Docker Ollama to `127.0.0.1`; share hardware polling; buffer stream markdown

**Download:** [local-coding-ai-0.1.1.vsix](https://github.com/SudoCasey/Local_Coding_AI/releases/download/v0.1.1/local-coding-ai-0.1.1.vsix)

## [0.1.0] — 2026-09-13

### Summary

Initial public release of the offline VS Code coding assistant powered by Ollama
and Qwen 2.5 Coder. Includes Auto mode routing, in-extension context limits,
model download/update UI, and cleanup on deactivate.

### Changes

- Offline Ollama-powered chat sidebar for VS Code (left or right sidebar)
- Auto Mode Smart Router with Fast / Primary / Heavy role panel (swap & download)
- Manual model picker for any installed Ollama tag
- In-extension Ollama context window controls (`num_ctx`) without Modelfiles
- Concurrent model downloads with progress; update checks show name, version/tag,
  and library notes
- Free VRAM, Compact, Clear Context, and Clean RAM controls
- Background Ollama launch from the extension
- Workspace-sandboxed editor attach / apply / insert actions
- Resource cleanup on extension deactivate (timers, pulls, context, VRAM unload)
- Optional Docker GPU compose stack under `docker/`

**Download:** [local-coding-ai-0.1.0.vsix](https://github.com/SudoCasey/Local_Coding_AI/releases/download/v0.1.0/local-coding-ai-0.1.0.vsix)
