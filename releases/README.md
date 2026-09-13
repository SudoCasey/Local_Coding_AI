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
| **0.1.1** | [local-coding-ai-0.1.1.vsix](https://github.com/SudoCasey/Local_Coding_AI/releases/download/v0.1.1/local-coding-ai-0.1.1.vsix) | Fixes Windows Ollama hang/flash for larger models; security + efficiency hardening |
| **0.1.0** | [local-coding-ai-0.1.0.vsix](https://github.com/SudoCasey/Local_Coding_AI/releases/download/v0.1.0/local-coding-ai-0.1.0.vsix) | Initial public release — Auto mode, context limits, model pulls, resource cleanup |

**Latest:** [local-coding-ai-0.1.1.vsix](https://github.com/SudoCasey/Local_Coding_AI/releases/download/v0.1.1/local-coding-ai-0.1.1.vsix)

### 0.1.1

Fixes Windows Ollama reliability: larger models (such as 7B) no longer hang on “Connecting…”, and CMD windows no longer flash when VS Code opens or Ollama starts. Also hardens security around remote URLs and workspace file tools.

Details: [`v0.1.1.md`](./v0.1.1.md)

### 0.1.0

Initial public release of the offline VS Code coding assistant powered by Ollama and Qwen 2.5 Coder. Includes Auto mode routing, in-extension context limits, model download/update UI, and cleanup on deactivate.

Details: [`v0.1.0.md`](./v0.1.0.md)

## Install

```powershell
code --install-extension .\local-coding-ai-0.1.1.vsix
```

Or: VS Code → **Extensions** → `⋯` → **Install from VSIX…**

## Publish a new release (maintainers)

1. Bump `"version"` in `package.json` (e.g. `0.1.1` → `0.2.0`).
2. Add a `releases/vX.X.X.md` notes file with **Summary** + **Changes**, and update [`CHANGELOG.md`](../CHANGELOG.md), this file, and the main [`README.md`](../README.md) Releases section.
3. Commit, push, and tag:

```powershell
git tag v0.2.0
git push origin v0.2.0
```

4. The [`release` workflow](../.github/workflows/release.yml) builds the VSIX and publishes a GitHub Release using `releases/vX.X.X.md` as the release body.

> `.vsix` files are gitignored and should **not** be committed to the repository.
