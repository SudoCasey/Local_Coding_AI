import * as fsp from 'fs/promises';
import * as path from 'path';
import { spawn } from 'child_process';
import * as vscode from 'vscode';

export interface ActiveEditorContext {
  filePath?: string;
  fileName?: string;
  relativePath?: string;
  languageId?: string;
  selectedText?: string;
  fullContent?: string;
  cursorLine?: number;
  totalLines?: number;
}

export interface WorkspaceCommandResult {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
  error?: string;
}

export class WorkspaceService {
  /**
   * Returns the absolute path of the root directory currently opened in VS Code
   */
  public getWorkspaceRoot(): string | undefined {
    const folders = vscode.workspace.workspaceFolders;
    return folders && folders.length > 0 ? folders[0].uri.fsPath : undefined;
  }

  /**
   * Returns the display name of the active workspace folder
   */
  public getWorkspaceName(): string {
    const folders = vscode.workspace.workspaceFolders;
    return folders && folders.length > 0 ? folders[0].name : 'Active Workspace';
  }

  /**
   * Verifies whether a given filesystem path is strictly located within the opened workspace directory.
   * Fails closed when no workspace folder is open.
   */
  public isPathWithinWorkspace(targetPath: string): boolean {
    const root = this.getWorkspaceRoot();
    if (!root || !targetPath) {
      return false;
    }
    const resolvedRoot = path.resolve(root).toLowerCase();
    const resolvedTarget = path.resolve(targetPath).toLowerCase();

    if (resolvedRoot === resolvedTarget) return true;
    const relative = path.relative(resolvedRoot, resolvedTarget);
    return !relative.startsWith('..') && !path.isAbsolute(relative);
  }

  private requireInWorkspaceEditor(action: string): vscode.TextEditor | undefined {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage(`No active editor open to ${action}.`);
      return undefined;
    }
    const root = this.getWorkspaceRoot();
    if (!root) {
      vscode.window.showErrorMessage(
        `Cannot ${action}: open a workspace folder first. File access is blocked until a folder is open.`
      );
      return undefined;
    }
    if (editor.document.uri.fsPath && !this.isPathWithinWorkspace(editor.document.uri.fsPath)) {
      vscode.window.showErrorMessage(
        `Cannot ${action}: active file is outside the opened workspace directory ("${root}").`
      );
      return undefined;
    }
    return editor;
  }

  /**
   * Retrieves context from the active text editor, strictly enforcing workspace boundary.
   */
  public getActiveEditorContext(options?: { includeFullContent?: boolean }): ActiveEditorContext | null {
    const includeFullContent = options?.includeFullContent !== false;
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return null;
    }

    const document = editor.document;
    const filePath = document.uri.fsPath;
    const fileName = path.basename(filePath);
    const root = this.getWorkspaceRoot();

    if (!root) {
      vscode.window.showWarningMessage(
        'Open a workspace folder to attach or edit files. Access is blocked until a folder is open.'
      );
      return null;
    }

    if (filePath && !this.isPathWithinWorkspace(filePath)) {
      vscode.window.showWarningMessage(
        `File "${fileName}" is outside the opened workspace directory ("${root}"). Access blocked by workspace boundary.`
      );
      return null;
    }

    const selection = editor.selection;
    const selectedText = document.getText(selection);
    const relativePath = path.relative(root, filePath);

    return {
      filePath,
      fileName,
      relativePath,
      languageId: document.languageId,
      selectedText: selectedText.length > 0 ? selectedText : undefined,
      fullContent: includeFullContent ? document.getText() : undefined,
      cursorLine: selection.active.line + 1,
      totalLines: document.lineCount,
    };
  }

  /**
   * Insert code at cursor position in active editor (guarded by workspace boundary)
   */
  public async insertAtCursor(code: string): Promise<boolean> {
    const editor = this.requireInWorkspaceEditor('insert code');
    if (!editor) {
      return false;
    }

    return editor.edit((editBuilder) => {
      editBuilder.insert(editor.selection.active, code);
    });
  }

  /**
   * Replace current selection in active editor (guarded by workspace boundary)
   */
  public async replaceSelection(code: string): Promise<boolean> {
    const editor = this.requireInWorkspaceEditor('modify code');
    if (!editor) {
      return false;
    }

    if (editor.selection.isEmpty) {
      return editor.edit((editBuilder) => {
        editBuilder.insert(editor.selection.active, code);
      });
    }

    return editor.edit((editBuilder) => {
      editBuilder.replace(editor.selection, code);
    });
  }

  /**
   * Apply code to active file with full replacement (guarded by workspace boundary)
   */
  public async applyCodeToActiveFile(newCode: string): Promise<boolean> {
    const editor = this.requireInWorkspaceEditor('apply code');
    if (!editor) {
      return false;
    }

    const doc = editor.document;
    const lastLine = Math.max(doc.lineCount - 1, 0);
    const fullRange = new vscode.Range(0, 0, lastLine, doc.lineAt(lastLine).text.length);

    return editor.edit((editBuilder) => {
      editBuilder.replace(fullRange, newCode);
    });
  }

  /**
   * Show a side-by-side diff in VS Code comparing original file with proposed code
   */
  public async showDiffPreview(newCode: string, title: string = 'Proposed Code'): Promise<void> {
    const editor = this.requireInWorkspaceEditor('show diff');
    if (!editor) {
      return;
    }

    const currentDoc = editor.document;
    const tempDoc = await vscode.workspace.openTextDocument({
      content: newCode,
      language: currentDoc.languageId,
    });

    await vscode.commands.executeCommand(
      'vscode.diff',
      currentDoc.uri,
      tempDoc.uri,
      `${path.basename(currentDoc.fileName)} ↔ ${title}`
    );
  }

  /**
   * Scan project file structure for context injection (strictly scoped to workspace)
   */
  public async getWorkspaceFileTree(maxFiles: number = 60): Promise<string> {
    const files = await vscode.workspace.findFiles(
      '**/*',
      '{**/node_modules/**,**/.git/**,**/dist/**,**/build/**,**/.next/**,**/vendor/**}',
      maxFiles
    );

    if (files.length === 0) {
      return '(Empty or single-file workspace)';
    }

    return files.map((f) => vscode.workspace.asRelativePath(f)).join('\n');
  }

  /**
   * Resolve a workspace-relative path to an absolute path, or undefined if outside root / no workspace.
   */
  public resolveWorkspacePath(relPath: string): { absPath: string; relPath: string } | undefined {
    const root = this.getWorkspaceRoot();
    if (!root) {
      return undefined;
    }
    const cleaned = String(relPath || '')
      .trim()
      .replace(/\\/g, '/')
      .replace(/^\.\/+/, '')
      .replace(/^\/+/, '');
    if (cleaned.includes('\0')) {
      return undefined;
    }
    if (!cleaned || cleaned === '.') {
      return { absPath: root, relPath: '.' };
    }
    const absPath = path.resolve(root, cleaned);
    if (!this.isPathWithinWorkspace(absPath)) {
      return undefined;
    }
    return { absPath, relPath: path.relative(root, absPath).replace(/\\/g, '/') };
  }

  public async readWorkspaceFile(
    relPath: string
  ): Promise<{ ok: true; path: string; content: string } | { ok: false; error: string }> {
    const resolved = this.resolveWorkspacePath(relPath);
    if (!resolved) {
      return { ok: false, error: `Path blocked or outside workspace: ${relPath}` };
    }
    try {
      const content = await fsp.readFile(resolved.absPath, 'utf8');
      return { ok: true, path: resolved.relPath, content };
    } catch (err: any) {
      return { ok: false, error: `Failed to read ${resolved.relPath}: ${err?.message || err}` };
    }
  }

  public async listWorkspaceDir(
    relPath: string = '.',
    maxEntries: number = 80
  ): Promise<{ ok: true; path: string; entries: string } | { ok: false; error: string }> {
    const target = relPath.trim() === '' || relPath.trim() === '.' ? '.' : relPath;
    const resolved = this.resolveWorkspacePath(target === '.' ? './' : target);
    // Allow listing workspace root
    const root = this.getWorkspaceRoot();
    if (!root) {
      return { ok: false, error: 'No workspace folder open.' };
    }
    const absPath =
      target === '.' ? root : resolved?.absPath;
    const displayPath = target === '.' ? '.' : resolved?.relPath;
    if (!absPath || displayPath === undefined) {
      return { ok: false, error: `Path blocked or outside workspace: ${relPath}` };
    }
    try {
      const dirents = await fsp.readdir(absPath, { withFileTypes: true });
      const lines: string[] = [];
      for (const d of dirents.slice(0, maxEntries)) {
        if (d.name === 'node_modules' || d.name === '.git' || d.name === 'dist') {
          continue;
        }
        lines.push(`${d.isDirectory() ? 'dir' : 'file'}\t${d.name}`);
      }
      if (dirents.length > maxEntries) {
        lines.push(`… (${dirents.length - maxEntries} more omitted)`);
      }
      return { ok: true, path: displayPath, entries: lines.join('\n') || '(empty)' };
    } catch (err: any) {
      return { ok: false, error: `Failed to list ${displayPath}: ${err?.message || err}` };
    }
  }

  /**
   * Write a file inside the workspace. Returns previous content (null if new file).
   */
  public async writeWorkspaceFile(
    relPath: string,
    content: string
  ): Promise<
    | { ok: true; path: string; before: string | null; created: boolean }
    | { ok: false; error: string }
  > {
    const resolved = this.resolveWorkspacePath(relPath);
    if (!resolved) {
      return { ok: false, error: `Path blocked or outside workspace: ${relPath}` };
    }
    try {
      let before: string | null = null;
      let created = false;
      try {
        before = await fsp.readFile(resolved.absPath, 'utf8');
      } catch {
        created = true;
        before = null;
      }
      await fsp.mkdir(path.dirname(resolved.absPath), { recursive: true });
      await fsp.writeFile(resolved.absPath, content, 'utf8');

      // Refresh editor if open
      const uri = vscode.Uri.file(resolved.absPath);
      const openDoc = vscode.workspace.textDocuments.find(
        (d) => d.uri.fsPath.toLowerCase() === resolved.absPath.toLowerCase()
      );
      if (openDoc && !openDoc.isDirty) {
        await vscode.workspace.openTextDocument(uri);
      }

      return { ok: true, path: resolved.relPath, before, created };
    } catch (err: any) {
      return { ok: false, error: `Failed to write ${resolved.relPath}: ${err?.message || err}` };
    }
  }

  public async applySearchReplace(
    relPath: string,
    search: string,
    replace: string
  ): Promise<
    | { ok: true; path: string; before: string; after: string }
    | { ok: false; error: string }
  > {
    const read = await this.readWorkspaceFile(relPath);
    if (!read.ok) {
      return read;
    }
    if (!search) {
      return { ok: false, error: `Empty SEARCH block for ${read.path}` };
    }
    if (!read.content.includes(search)) {
      return {
        ok: false,
        error: `SEARCH text not found in ${read.path}. Ensure the SEARCH block matches the file exactly.`,
      };
    }
    const after = read.content.replace(search, replace);
    const wrote = await this.writeWorkspaceFile(read.path, after);
    if (!wrote.ok) {
      return wrote;
    }
    return { ok: true, path: read.path, before: read.content, after };
  }

  public async deleteWorkspaceFile(
    relPath: string
  ): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
    const resolved = this.resolveWorkspacePath(relPath);
    if (!resolved) {
      return { ok: false, error: `Path blocked or outside workspace: ${relPath}` };
    }
    try {
      await fsp.unlink(resolved.absPath);
      return { ok: true, path: resolved.relPath };
    } catch (err: any) {
      return { ok: false, error: `Failed to delete ${resolved.relPath}: ${err?.message || err}` };
    }
  }

  /**
   * Run a shell command with cwd = workspace root. Does not check Allowlist — caller must.
   */
  public async runWorkspaceCommand(
    command: string,
    options?: { timeoutMs?: number; abortSignal?: AbortSignal }
  ): Promise<WorkspaceCommandResult> {
    const root = this.getWorkspaceRoot();
    if (!root) {
      return {
        ok: false,
        exitCode: null,
        stdout: '',
        stderr: '',
        error: 'No workspace folder open.',
      };
    }
    const timeoutMs = options?.timeoutMs ?? 60000;
    const isWin = process.platform === 'win32';
    const shell = isWin ? process.env.ComSpec || 'cmd.exe' : '/bin/bash';
    const args = isWin ? ['/d', '/s', '/c', command] : ['-lc', command];

    return new Promise((resolve) => {
      let settled = false;
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const child = spawn(shell, args, {
        cwd: root,
        env: process.env,
        windowsHide: true,
        shell: false,
      });

      const timer = setTimeout(() => {
        timedOut = true;
        try {
          child.kill();
        } catch {
          // ignore
        }
      }, timeoutMs);

      const finish = (result: WorkspaceCommandResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };

      options?.abortSignal?.addEventListener('abort', () => {
        try {
          child.kill();
        } catch {
          // ignore
        }
        finish({
          ok: false,
          exitCode: null,
          stdout,
          stderr,
          error: 'Command aborted.',
        });
      });

      child.stdout?.on('data', (chunk) => {
        stdout += String(chunk);
        if (stdout.length > 200_000) {
          stdout = stdout.slice(0, 200_000) + '\n…(truncated)';
        }
      });
      child.stderr?.on('data', (chunk) => {
        stderr += String(chunk);
        if (stderr.length > 100_000) {
          stderr = stderr.slice(0, 100_000) + '\n…(truncated)';
        }
      });
      child.on('error', (err) => {
        finish({
          ok: false,
          exitCode: null,
          stdout,
          stderr,
          error: err.message,
        });
      });
      child.on('close', (code) => {
        finish({
          ok: !timedOut && code === 0,
          exitCode: code,
          stdout,
          stderr,
          timedOut,
          error: timedOut ? `Command timed out after ${timeoutMs}ms` : undefined,
        });
      });
    });
  }
}
