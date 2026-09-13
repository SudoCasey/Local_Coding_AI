import * as path from 'path';
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
}
