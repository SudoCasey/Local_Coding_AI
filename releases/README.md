# Releases

VS Code extension builds are published as:

```text
local-coding-ai-X.X.X.vsix
```

Direct download URLs look like:

```text
https://github.com/SudoCasey/Local_Coding_AI/releases/download/vX.X.X/local-coding-ai-X.X.X.vsix
```

Full change history: [`CHANGELOG.md`](../CHANGELOG.md)

## Current

| Version | Download | Summary |
| :--- | :--- | :--- |
| **0.3.5** | [local-coding-ai-0.3.5.vsix](https://github.com/SudoCasey/Local_Coding_AI/releases/download/v0.3.5/local-coding-ai-0.3.5.vsix) | Recover malformed tool tags so the assistant actually edits the repo |
| **0.3.4** | [local-coding-ai-0.3.4.vsix](https://github.com/SudoCasey/Local_Coding_AI/releases/download/v0.3.4/local-coding-ai-0.3.4.vsix) | Unload 1.5B before 7B; unwrap JSON replies; stable chat scroll |
| **0.3.3** | [local-coding-ai-0.3.3.vsix](https://github.com/SudoCasey/Local_Coding_AI/releases/download/v0.3.3/local-coding-ai-0.3.3.vsix) | Keep the chat model in VRAM between prompts |
| **0.3.2** | [local-coding-ai-0.3.2.vsix](https://github.com/SudoCasey/Local_Coding_AI/releases/download/v0.3.2/local-coding-ai-0.3.2.vsix) | Act on the workspace instead of refusing or asking for more details |
| **0.3.1** | [local-coding-ai-0.3.1.vsix](https://github.com/SudoCasey/Local_Coding_AI/releases/download/v0.3.1/local-coding-ai-0.3.1.vsix) | Strip markdown fences from AI file writes; keep VSIX in repo root |
| **0.3.0** | [local-coding-ai-0.3.0.vsix](https://github.com/SudoCasey/Local_Coding_AI/releases/download/v0.3.0/local-coding-ai-0.3.0.vsix) | Agentic multi-file edits + Undo; Allowlist only for command execution |
| **0.2.0** | [local-coding-ai-0.2.0.vsix](https://github.com/SudoCasey/Local_Coding_AI/releases/download/v0.2.0/local-coding-ai-0.2.0.vsix) | Allowlist / Run everything modes for AI actions |
| **0.1.1** | [local-coding-ai-0.1.1.vsix](https://github.com/SudoCasey/Local_Coding_AI/releases/download/v0.1.1/local-coding-ai-0.1.1.vsix) | Fixes Windows Ollama hang/flash for larger models; security + efficiency hardening |
| **0.1.0** | [local-coding-ai-0.1.0.vsix](https://github.com/SudoCasey/Local_Coding_AI/releases/download/v0.1.0/local-coding-ai-0.1.0.vsix) | Initial public release — Auto mode, context limits, model pulls, resource cleanup |

**Latest:** [local-coding-ai-0.3.5.vsix](https://github.com/SudoCasey/Local_Coding_AI/releases/download/v0.3.5/local-coding-ai-0.3.5.vsix)

### 0.3.5

Recover malformed tool tags (backticks, fences, XML, JSON) so LIST/READ/WRITE run instead of being shown as chat. Repo tasks list the workspace root. Greetings no longer inspect the open file.

Details: [`v0.3.5.md`](./v0.3.5.md)

### 0.3.4

Unload 1.5B and wait before loading 7B. Unwrap JSON replies so edits apply. Strip trailing fences from writes. Chat does not jump to the bottom while you are scrolled up.

Details: [`v0.3.4.md`](./v0.3.4.md)

### 0.3.3

The current chat model stays in VRAM between prompts. It is unloaded only on Free VRAM, a model switch, or VS Code close.

Details: [`v0.3.3.md`](./v0.3.3.md)

### 0.3.2

The assistant acts on the open workspace instead of refusing or asking for more details. Wrapping markdown fences are still stripped from file writes.

Details: [`v0.3.2.md`](./v0.3.2.md)

### 0.3.1

File edits stay valid source: wrapping markdown fences are stripped from WRITE
and REPLACE bodies, and the packaged VSIX is kept in the repository root.

Details: [`v0.3.1.md`](./v0.3.1.md)

### 0.3.0

The assistant can read and edit multiple workspace files itself (no Allowlist for writing code), then list changed files with Undo. Command execution (`npm`, `git`, `node`, …) still requires Allowlist approval.

Details: [`v0.3.0.md`](./v0.3.0.md)

### 0.2.0

Adds Allowlist / Run everything modes so users control whether command execution needs approval — with one-shot Run or persistent Add to Allowlist.

Details: [`v0.2.0.md`](./v0.2.0.md)

### 0.1.1

Fixes Windows Ollama reliability: larger models (such as 7B) no longer hang on “Connecting…”, and CMD windows no longer flash when VS Code opens or Ollama starts. Also hardens security around remote URLs and workspace file tools.

Details: [`v0.1.1.md`](./v0.1.1.md)

### 0.1.0

Initial public release of the offline VS Code coding assistant powered by Ollama and Qwen 2.5 Coder. Includes Auto mode routing, in-extension context limits, model download/update UI, and cleanup on deactivate.

Details: [`v0.1.0.md`](./v0.1.0.md)

## Install

```powershell
code --install-extension .\local-coding-ai-0.3.5.vsix
```

Or: VS Code → **Extensions** → `⋯` → **Install from VSIX…**

## Publish a new release (maintainers)

1. Bump `"version"` in `package.json` (e.g. `0.3.0` → `0.3.1`).
2. Add a `releases/vX.X.X.md` notes file with **Summary** + **Changes**, and update [`CHANGELOG.md`](../CHANGELOG.md), this file, and the main [`README.md`](../README.md) Releases section.
3. Package the VSIX into the **repository root** (so it is available locally without downloading from GitHub):

```powershell
npm run package
```

That writes `local-coding-ai-X.X.X.vsix` next to `package.json`. Commit that file with the release (older root `.vsix` files can stay or be removed).
4. Commit, push, and tag:

```powershell
git tag v0.3.1
git push origin v0.3.1
```

5. The [`release` workflow](../.github/workflows/release.yml) builds the VSIX, publishes a GitHub Release using `releases/vX.X.X.md` as the release body, and commits the packaged file to the repository root on `main` if it is not already there.
