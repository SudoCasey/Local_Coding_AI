# Local Coding AI

**Completely offline, private VS Code coding assistant** powered by [Ollama](https://ollama.com) and open-weight models. No cloud APIs. Your prompts, code, and weights stay on your machine.

**Author:** [Casey Friedrich](https://cfriedrich.net)

[![Version](https://img.shields.io/badge/version-0.3.3-blue.svg)](https://github.com/SudoCasey/Local_Coding_AI/releases)
[![VS Code](https://img.shields.io/badge/VS%20Code-%5E1.85.0-007ACC.svg)](https://code.visualstudio.com/)
[![License](https://img.shields.io/badge/license-see%20repo-lightgrey.svg)](#license)

| | |
| :--- | :--- |
| **Latest install package** | [⬇️ local-coding-ai-0.3.3.vsix](https://github.com/SudoCasey/Local_Coding_AI/releases/download/v0.3.3/local-coding-ai-0.3.3.vsix) |
| **Releases** | [github.com/SudoCasey/Local_Coding_AI/releases](https://github.com/SudoCasey/Local_Coding_AI/releases) |
| **Backend** | Ollama at `http://127.0.0.1:11434` |
| **Default models** | Qwen 2.5 Coder `1.5b` / `7b` / `14b` |

---

## Releases

### Download & install

**[⬇️ local-coding-ai-0.3.3.vsix](https://github.com/SudoCasey/Local_Coding_AI/releases/download/v0.3.3/local-coding-ai-0.3.3.vsix)**

```powershell
code --install-extension local-coding-ai-0.3.3.vsix
```

Or in VS Code: **Extensions** → `⋯` → **Install from VSIX…**

| Version | Download | Summary |
| :--- | :--- | :--- |
| **0.3.3** | [local-coding-ai-0.3.3.vsix](https://github.com/SudoCasey/Local_Coding_AI/releases/download/v0.3.3/local-coding-ai-0.3.3.vsix) | Keep the chat model in VRAM between prompts |
| **0.3.2** | [local-coding-ai-0.3.2.vsix](https://github.com/SudoCasey/Local_Coding_AI/releases/download/v0.3.2/local-coding-ai-0.3.2.vsix) | Act on the workspace instead of refusing or asking for more details |
| **0.3.1** | [local-coding-ai-0.3.1.vsix](https://github.com/SudoCasey/Local_Coding_AI/releases/download/v0.3.1/local-coding-ai-0.3.1.vsix) | Strip markdown fences from AI file writes; keep VSIX in repo root |
| **0.3.0** | [local-coding-ai-0.3.0.vsix](https://github.com/SudoCasey/Local_Coding_AI/releases/download/v0.3.0/local-coding-ai-0.3.0.vsix) | Agentic multi-file edits + Undo; Allowlist only for command execution |
| **0.2.0** | [local-coding-ai-0.2.0.vsix](https://github.com/SudoCasey/Local_Coding_AI/releases/download/v0.2.0/local-coding-ai-0.2.0.vsix) | Allowlist / Run everything modes for AI actions |
| **0.1.1** | [local-coding-ai-0.1.1.vsix](https://github.com/SudoCasey/Local_Coding_AI/releases/download/v0.1.1/local-coding-ai-0.1.1.vsix) | Fixes Windows Ollama hang/flash for larger models; security + efficiency hardening |
| **0.1.0** | [local-coding-ai-0.1.0.vsix](https://github.com/SudoCasey/Local_Coding_AI/releases/download/v0.1.0/local-coding-ai-0.1.0.vsix) | Initial public release — Auto mode, context limits, model pulls, resource cleanup |

### 0.3.3

The current chat model stays in VRAM between prompts. It is unloaded only on Free VRAM, a model switch, or VS Code close.

Full notes: [`releases/v0.3.3.md`](./releases/v0.3.3.md) · [`CHANGELOG.md`](./CHANGELOG.md)

### 0.3.2

The assistant acts on the open workspace instead of refusing or asking for more details. Wrapping markdown fences are still stripped from file writes.

Full notes: [`releases/v0.3.2.md`](./releases/v0.3.2.md) · [`CHANGELOG.md`](./CHANGELOG.md)

### 0.3.1

File edits stay valid source: wrapping markdown fences (` ```css `, ` ```javascript `, ` ```html `, …) are stripped before write, and the packaged VSIX is kept in the repository root.

Full notes: [`releases/v0.3.1.md`](./releases/v0.3.1.md) · [`CHANGELOG.md`](./CHANGELOG.md)

### 0.3.0

The assistant can read and edit multiple workspace files itself (no Allowlist for writing code), then list changed files with Undo. Command execution (`npm`, `git`, `node`, …) still requires Allowlist approval.

Full notes: [`releases/v0.3.0.md`](./releases/v0.3.0.md) · [`CHANGELOG.md`](./CHANGELOG.md)

### 0.2.0

Adds Allowlist / Run everything modes so users control whether command execution needs approval — with one-shot Run or persistent Add to Allowlist.

Full notes: [`releases/v0.2.0.md`](./releases/v0.2.0.md) · [`CHANGELOG.md`](./CHANGELOG.md)

### 0.1.1

Fixes Windows Ollama reliability: larger models (such as 7B) no longer hang on “Connecting…”, and CMD windows no longer flash when VS Code opens or Ollama starts. Also hardens security around remote URLs and workspace file tools.

Full notes: [`releases/v0.1.1.md`](./releases/v0.1.1.md) · [`CHANGELOG.md`](./CHANGELOG.md)

### 0.1.0

Initial public release of the offline VS Code coding assistant powered by Ollama and Qwen 2.5 Coder. Includes Auto mode routing, in-extension context limits, model download/update UI, and cleanup on deactivate.

Full notes: [`releases/v0.1.0.md`](./releases/v0.1.0.md) · [`CHANGELOG.md`](./CHANGELOG.md)

See [`releases/README.md`](./releases/README.md) for naming and how maintainers publish a new build.

---

## Features

- **100% offline & private** — Inference runs locally through Ollama. No required external AI APIs.
- **Qwen 2.5 Coder ready** — Defaults: Fast `1.5b`, Primary `7b`, Heavy `14b` (editable).
- **Auto Mode (Smart Router)** — Routes by task type across Fast / Primary / Heavy roles. Swap or download role models from the sidebar panel.
- **Manual model picker** — Use any installed Ollama tag.
- **Smart context compaction** — Auto-summarizes older turns near the context threshold; keeps recent work intact.
- **In-extension context limits** — Change Ollama `num_ctx` from the sidebar (`2K`–`128K` or Custom) without editing Modelfiles.
- **Model pull & update checks** — Concurrent downloads with progress; update checks show **name, version/tag, and library notes** (not raw SHAs).
- **Resource controls**
  - **Free VRAM** — Unload models (`keep_alive: 0`)
  - **Compact** — Manual compaction
  - **Clear Context** — Reset conversation memory
  - **Clean RAM** — Drop local caches
- **Editor integration** — Attach active file / selection; Copy / Insert on code blocks; Explain / Refactor / Tests / Fix from the editor context menu.
- **Agentic multi-file edits** — Reads and writes project files automatically; shows a Files changed list with Undo.
- **Execution permissions** — **Allowlist** (approve `npm` / `git` / `node` / …) or **Run everything**. Writing files never needs approval.
- **Left or right sidebar** — Toggle Activity Bar vs Secondary Side Bar.
- **Silent Ollama launch** — Starts `ollama serve` in the background with no console/GUI popup.
- **Cleanup on exit** — Stops timers, aborts pulls/generation, clears context, unloads VRAM when the extension deactivates.
- **Docker / WSL2** — Optional GPU-accelerated Ollama via `docker/docker-compose.yml`.

---

## Recommended hardware

Tuned for a local workstation similar to:

| Component | Profile |
| :--- | :--- |
| GPU | NVIDIA RTX 3080 (12 GB VRAM) |
| RAM | 32 GB |
| CPU | AMD Ryzen 7 5800X3D (or similar) |
| OS | Windows 10+ (native Ollama) or WSL2 + Docker |

| Auto role | Default tag | Approx. VRAM | Typical use |
| :--- | :--- | :--- | :--- |
| **Fast** | `qwen2.5-coder:1.5b` | ~1.5 GB | Quick Q&A, syntax, compaction |
| **Primary** | `qwen2.5-coder:7b` | ~5.5 GB | Daily coding & debugging |
| **Heavy** | `qwen2.5-coder:14b` | ~9 GB | Large refactors / architecture |

---

## Prerequisites

1. [VS Code](https://code.visualstudio.com/) `1.85.0` or newer  
2. [Ollama](https://ollama.com/download) installed and reachable at `http://127.0.0.1:11434`  
3. At least one coding model pulled (recommended):

```powershell
ollama pull qwen2.5-coder:7b
ollama pull qwen2.5-coder:1.5b
# optional heavy role:
ollama pull qwen2.5-coder:14b
```

### Docker (optional, WSL2 + NVIDIA)

```bash
cd docker
docker compose up -d
docker exec -it local-coding-ai-ollama ollama pull qwen2.5-coder:7b
docker exec -it local-coding-ai-ollama ollama pull qwen2.5-coder:1.5b
```

See [`docker/README.md`](./docker/README.md) for GPU passthrough details.

---

## Install

### From GitHub Releases (end users)

Download **[local-coding-ai-0.3.3.vsix](https://github.com/SudoCasey/Local_Coding_AI/releases/download/v0.3.3/local-coding-ai-0.3.3.vsix)** and run:

```powershell
code --install-extension .\local-coding-ai-0.3.3.vsix
```

### From source (developers)

The latest packaged build is kept in the repo root so you can install it without downloading from GitHub:

```powershell
code --install-extension .\local-coding-ai-0.3.3.vsix
```

```powershell
git clone https://github.com/SudoCasey/Local_Coding_AI.git
cd Local_Coding_AI
npm install
npm run compile
```

- **Debug:** open the folder in VS Code → press `F5` (Extension Development Host).  
- **Package locally** (also used when publishing a release):

```powershell
npm run package
code --install-extension .\local-coding-ai-0.3.3.vsix
```

---

## Usage

1. Click the **Local Coding AI** icon in the Activity Bar (or Secondary Side Bar if configured).
2. Ensure Ollama is online (use **Launch Ollama** if needed — starts headless in the background).
3. Choose **Auto Mode (Smart Router)** or a specific installed model.
4. In Auto mode, use the **Auto Mode Models** panel to view/swap Fast · Primary · Heavy, or download more.
5. Ask the assistant to change the project — it can read and edit multiple files, then show **Files changed** with **Undo**.
6. Choose **AI execution → Allowlist** or **Run everything** to control command execution (`npm`, `git`, `node`, …). File writes never need approval.

---

## Configuration

VS Code Settings → search `localCodingAI`, or edit `settings.json`:

| Setting | Default | Description |
| :--- | :--- | :--- |
| `localCodingAI.sidebarPosition` | `left` | `left` (Activity Bar) or `right` (Secondary Side Bar) |
| `localCodingAI.ollamaUrl` | `http://127.0.0.1:11434` | Ollama API base URL |
| `localCodingAI.primaryModel` | `qwen2.5-coder:7b` | Auto-mode primary coding model |
| `localCodingAI.fastModel` | `qwen2.5-coder:1.5b` | Auto-mode fast / compaction model |
| `localCodingAI.heavyModel` | `qwen2.5-coder:14b` | Auto-mode heavy architecture model |
| `localCodingAI.autoModelRouting` | `true` | Prefer Auto routing when enabled |
| `localCodingAI.contextWindow` | `16384` | Tokens passed to Ollama as `num_ctx` |
| `localCodingAI.autoCompactionThreshold` | `0.75` | Fraction of context that triggers compaction |
| `localCodingAI.gpuLayers` | `99` | Layers offloaded to GPU |
| `localCodingAI.temperature` | `0.2` | Sampling temperature |
| `localCodingAI.keepAlive` | `-1` | Keep the model in VRAM until Free VRAM, a model switch, or VS Code closes (`-1` = stay loaded) |
| `localCodingAI.writePermissionMode` | `allowlist` | `allowlist` or `runEverything` for **command execution** |
| `localCodingAI.writeAllowlist` | `[]` | Executor families allowed without prompting (e.g. `npm`, `git`) |

**Execution permissions:** Writing/editing files is always allowed in-workspace. Running commands requires Allowlist approval (Run once or Add to Allowlist) unless mode is Run everything. Manage via the sidebar lock button or **Local Coding AI: Manage Write Permissions**.

**Context window** can also be changed from the sidebar **Ctx** pill (`2K`–`128K` or Custom) or the command **Local Coding AI: Set Context Window Limit**.

---

## Commands

| Command | Action |
| :--- | :--- |
| `Local Coding AI: Open Chat` | Focus the sidebar chat |
| `Local Coding AI: Launch Ollama` | Start Ollama headlessly |
| `Local Coding AI: Free GPU VRAM` | Unload models |
| `Local Coding AI: Compact Conversation Context` | Manual compaction |
| `Local Coding AI: Clear Chat Context` | Reset conversation |
| `Local Coding AI: Set Context Window Limit` | Change `num_ctx` |
| `Local Coding AI: Manage Write Permissions` | Switch Allowlist / Run everything and edit execution allowlist |
| `Local Coding AI: Toggle Sidebar Position` | Left ↔ right |
| `Local Coding AI: Check for Model Updates` | Version / notes check |
| Explain / Refactor / Generate Tests / Fix | Editor context menu |

---

## Development

```powershell
npm install
npm run compile      # build extension + webview
npm run typecheck    # tsc --noEmit
npm test             # verification suite
npm run watch        # rebuild on change
```

Project layout:

```text
src/
  extension.ts              # activate / deactivate & commands
  services/                 # Ollama, context, router, workspace
  sidebar/                  # Webview provider + UI
docker/                     # Optional GPU Ollama compose stack
releases/                   # Release notes & VSIX naming docs
```

---

## Resource cleanup

On VS Code close, reload, or extension disable:

- Status polling timers stop  
- In-flight chat / pulls abort  
- Conversation context is cleared  
- Models are unloaded from VRAM (`keep_alive: 0`)  

The **Ollama daemon** is left running if present (it may be shared with other tools). Use **Free VRAM** anytime while the extension is open.

---

## Privacy

- Designed for local-only inference via Ollama. Non-loopback `ollamaUrl` values require an explicit confirmation before prompts are sent.  
- Model **update checks** optionally contact the public Ollama registry / library pages when you click Check Updates.  
- Chat, workspace files, and generation stay on your machine for normal use. Open a workspace folder to attach or apply code — file tools fail closed otherwise.

---

## License

See repository license information when published. Contributions and issues are welcome via GitHub.

---

## Links

- **Releases (VSIX downloads):** https://github.com/SudoCasey/Local_Coding_AI/releases  
- **Latest package:** [local-coding-ai-0.3.3.vsix](https://github.com/SudoCasey/Local_Coding_AI/releases/download/v0.3.3/local-coding-ai-0.3.3.vsix)  
- **Ollama:** https://ollama.com  
- **Qwen 2.5 Coder library:** https://ollama.com/library/qwen2.5-coder
