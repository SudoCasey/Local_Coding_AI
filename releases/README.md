# Releases

VS Code extension builds are published as:

```text
local-coding-ai-X.X.X.vsix
```

Direct download URLs look like:

```text
https://github.com/SudoCasey/Local_Coding_AI/releases/download/vX.X.X/local-coding-ai-X.X.X.vsix
```

## Current

| Version | Download |
| :--- | :--- |
| **0.1.1** | [local-coding-ai-0.1.1.vsix](https://github.com/SudoCasey/Local_Coding_AI/releases/download/v0.1.1/local-coding-ai-0.1.1.vsix) |
| **0.1.0** | [local-coding-ai-0.1.0.vsix](https://github.com/SudoCasey/Local_Coding_AI/releases/download/v0.1.0/local-coding-ai-0.1.0.vsix) |

**Latest:** [local-coding-ai-0.1.1.vsix](https://github.com/SudoCasey/Local_Coding_AI/releases/download/v0.1.1/local-coding-ai-0.1.1.vsix)

## Install

```powershell
code --install-extension .\local-coding-ai-0.1.1.vsix
```

Or: VS Code → **Extensions** → `⋯` → **Install from VSIX…**

## Publish a new release (maintainers)

1. Bump `"version"` in `package.json` (e.g. `0.1.1` → `0.2.0`).
2. Update the version table in this file and the main [`README.md`](../README.md) Releases section.
3. Commit, push, and tag:

```powershell
git tag v0.2.0
git push origin v0.2.0
```

4. The [`release` workflow](../.github/workflows/release.yml) builds the VSIX and publishes a GitHub Release with a direct download link.

> `.vsix` files are gitignored and should **not** be committed to the repository.
