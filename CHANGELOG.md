# Changelog

All notable changes to **Local Coding AI** are documented here.
Released builds are published as `local-coding-ai-X.X.X.vsix` on
[GitHub Releases](https://github.com/SudoCasey/Local_Coding_AI/releases).

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
