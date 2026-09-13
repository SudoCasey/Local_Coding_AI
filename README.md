# Local Coding AI

**Completely offline, private VS Code coding assistant** powered by [Ollama](https://ollama.com) and open-weight models. No cloud APIs. Your prompts, code, and weights stay on your machine.

[![Version](https://img.shields.io/badge/version-0.1.0-blue.svg)](https://github.com/SudoCasey/Local_Coding_AI/releases)
[![VS Code](https://img.shields.io/badge/VS%20Code-%5E1.85.0-007ACC.svg)](https://code.visualstudio.com/)
[![License](https://img.shields.io/badge/license-see%20repo-lightgrey.svg)](#license)

| | |
| :--- | :--- |
| **Latest install package** | [`local-coding-ai-0.1.0.vsix`](https://github.com/SudoCasey/Local_Coding_AI/releases/latest) |
| **Releases** | [github.com/SudoCasey/Local_Coding_AI/releases](https://github.com/SudoCasey/Local_Coding_AI/releases) |
| **Backend** | Ollama at `http://127.0.0.1:11434` |
| **Default models** | Qwen 2.5 Coder `1.5b` / `7b` / `14b` |

---

## Releases

Pre-built VS Code extension packages are published on the GitHub **Releases** page as:

```text
local-coding-ai-X.X.X.vsix
```

### Download & install (recommended)

1. Open **[Releases](https://github.com/SudoCasey/Local_Coding_AI/releases)**.
2. Download the latest asset: **`local-coding-ai-X.X.X.vsix`** (for example `local-coding-ai-0.1.0.vsix`).
3. Install into VS Code:

```powershell
code --install-extension local-coding-ai-0.1.0.vsix
```

Or in VS Code: **Extensions** → `⋯` → **Install from VSIX…** → select the downloaded file.

| Version | VSIX asset | Notes |
| :--- | :--- | :--- |
| **0.1.0** | [`local-coding-ai-0.1.0.vsix`](https://github.com/SudoCasey/Local_Coding_AI/releases/tag/v0.1.0) | Initial public release — Auto mode roles, context limits, silent Ollama launch, resource cleanup |

> Assets are attached on GitHub Releases (not committed to the repo). See [`releases/README.md`](./releases/README.md) for the asset naming convention and how maintainers publish a new build.

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
- **Editor integration** — Attach active file / selection; Copy / Insert / Apply on code blocks; Explain / Refactor / Tests / Fix from the editor context menu.
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

See **[Releases](#releases)** above — download `local-coding-ai-X.X.X.vsix` and run:

```powershell
code --install-extension .\local-coding-ai-X.X.X.vsix
```

### From source (developers)

```powershell
git clone https://github.com/SudoCasey/Local_Coding_AI.git
cd Local_Coding_AI
npm install
npm run compile
```

- **Debug:** open the folder in VS Code → press `F5` (Extension Development Host).  
- **Package locally:**

```powershell
npx @vscode/vsce package --no-dependencies
code --install-extension .\local-coding-ai-0.1.0.vsix
```

---

## Usage

1. Click the **Local Coding AI** icon in the Activity Bar (or Secondary Side Bar if configured).
2. Ensure Ollama is online (use **Launch Ollama** if needed — starts headless in the background).
3. Choose **Auto Mode (Smart Router)** or a specific installed model.
4. In Auto mode, use the **Auto Mode Models** panel to view/swap Fast · Primary · Heavy, or download more.
5. Chat, attach files/selections, and use code-block actions to insert or apply changes inside the workspace.

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
| `localCodingAI.keepAlive` | `10m` | How long models stay loaded after a request |

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

- Designed for local-only inference via Ollama.  
- Model **update checks** optionally contact the public Ollama registry / library pages when you click Check Updates.  
- Chat, workspace files, and generation stay on your machine for normal use.

---

## License

See repository license information when published. Contributions and issues are welcome via GitHub.

---

## Links

- **Releases (VSIX downloads):** https://github.com/SudoCasey/Local_Coding_AI/releases  
- **Latest package:** https://github.com/SudoCasey/Local_Coding_AI/releases/latest  
- **Ollama:** https://ollama.com  
- **Qwen 2.5 Coder library:** https://ollama.com/library/qwen2.5-coder
