# Releases

Published VS Code extension builds are distributed as GitHub Release assets named:

```text
local-coding-ai-X.X.X.vsix
```

where `X.X.X` matches the `"version"` field in [`package.json`](../package.json).

## Current

| Version | Asset | GitHub Release |
| :--- | :--- | :--- |
| **0.1.0** | `local-coding-ai-0.1.0.vsix` | [v0.1.0](https://github.com/SudoCasey/Local_Coding_AI/releases/tag/v0.1.0) |

**Latest download:** https://github.com/SudoCasey/Local_Coding_AI/releases/latest

## Install a release asset

```powershell
# After downloading local-coding-ai-X.X.X.vsix from the Releases page:
code --install-extension .\local-coding-ai-0.1.0.vsix
```

Or: VS Code → **Extensions** → `⋯` → **Install from VSIX…**

## Publish a new release (maintainers)

1. Bump `"version"` in `package.json` (e.g. `0.1.0` → `0.2.0`).
2. Update the version table in this file and the main [`README.md`](../README.md) Releases section.
3. Build the VSIX:

```powershell
npm install
npm run compile
npx @vscode/vsce package --no-dependencies
```

4. Commit, push, and tag:

```powershell
git tag v0.2.0
git push origin v0.2.0
```

5. Create a GitHub Release for that tag and **attach** `local-coding-ai-X.X.X.vsix` as a binary asset  
   (GitHub → **Releases** → **Draft a new release**, or use the [`release` workflow](../.github/workflows/release.yml) if enabled).

> `.vsix` files are gitignored and should **not** be committed to the repository. Always attach them on the Releases page.
