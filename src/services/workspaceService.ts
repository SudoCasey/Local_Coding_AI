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
   * Verifies whether a given filesystem path is strictly located within the opened workspace directory
   */
  public isPathWithinWorkspace(targetPath: string): boolean {
    const root = this.getWorkspaceRoot();
    if (!root) {
      // If no directory or workspace folder is opened, allow active file operations
      return true;
    }
    const resolvedRoot = path.resolve(root).toLowerCase();
    const resolvedTarget = path.resolve(targetPath).toLowerCase();

    // Check exact match or subpath
    if (resolvedRoot === resolvedTarget) return true;
    const relative = path.relative(resolvedRoot, resolvedTarget);
    return !relative.startsWith('..') && !path.isAbsolute(relative);
  }

  /**
   * Retrieves context from the active text editor in VS Code, strictly enforcing workspace boundary
   */
  public getActiveEditorContext(): ActiveEditorContext | null {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return null;
    }

    const document = editor.document;
    const filePath = document.uri.fsPath;
    const fileName = path.basename(filePath);

    // Enforce that active file is inside the opened workspace directory
    const root = this.getWorkspaceRoot();
    if (root && filePath && !this.isPathWithinWorkspace(filePath)) {
      vscode.window.showWarningMessage(
        `File "${fileName}" is outside the opened workspace directory ("${root}"). Access blocked by workspace boundary.`
      );
      return null;
    }

    const selection = editor.selection;
    const selectedText = document.getText(selection);
    const fullContent = document.getText();
    const relativePath = root ? path.relative(root, filePath) : vscode.workspace.asRelativePath(document.uri);

    return {
      filePath,
      fileName,
      relativePath,
      languageId: document.languageId,
      selectedText: selectedText.length > 0 ? selectedText : undefined,
      fullContent,
      cursorLine: selection.active.line + 1,
      totalLines: document.lineCount,
    };
  }

  /**
   * Insert code at cursor position in active editor (guarded by workspace boundary)
   */
  public async insertAtCursor(code: string): Promise<boolean> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('No active editor open to insert code.');
      return false;
    }

    const root = this.getWorkspaceRoot();
    if (root && editor.document.uri.fsPath && !this.isPathWithinWorkspace(editor.document.uri.fsPath)) {
      vscode.window.showErrorMessage('Cannot insert code: Active file is outside the opened workspace directory.');
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
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('No active editor open to replace selection.');
      return false;
    }

    const root = this.getWorkspaceRoot();
    if (root && editor.document.uri.fsPath && !this.isPathWithinWorkspace(editor.document.uri.fsPath)) {
      vscode.window.showErrorMessage('Cannot modify code: Active file is outside the opened workspace directory.');
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
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('No active editor open to apply code.');
      return false;
    }

    const root = this.getWorkspaceRoot();
    if (root && editor.document.uri.fsPath && !this.isPathWithinWorkspace(editor.document.uri.fsPath)) {
      vscode.window.showErrorMessage('Cannot apply code: Active file is outside the opened workspace directory.');
      return false;
    }

    const doc = editor.document;
    const fullRange = new vscode.Range(
      doc.positionAt(0),
      doc.positionAt(doc.getText().length)
    );

    return editor.edit((editBuilder) => {
      editBuilder.replace(fullRange, newCode);
    });
  }

  /**
   * Show a side-by-side diff in VS Code comparing original file with proposed code
   */
  public async showDiffPreview(newCode: string, title: string = 'Proposed Code'): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('No active editor open for diff preview.');
      return;
    }

    const root = this.getWorkspaceRoot();
    if (root && editor.document.uri.fsPath && !this.isPathWithinWorkspace(editor.document.uri.fsPath)) {
      vscode.window.showErrorMessage('Cannot show diff: Active file is outside the opened workspace directory.');
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
