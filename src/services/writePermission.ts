import * as vscode from 'vscode';
import {
  describeWriteAction,
  isWriteActionAllowlisted,
  WritePermissionMode,
} from './writePermissionPolicy';

export type { WritePermissionMode, WriteActionKind } from './writePermissionPolicy';
export {
  describeWriteAction,
  isWriteActionAllowlisted,
  normalizeWriteActionType,
} from './writePermissionPolicy';

export class WritePermissionService {
  public getMode(): WritePermissionMode {
    const mode = vscode.workspace
      .getConfiguration('localCodingAI')
      .get<string>('writePermissionMode');
    return mode === 'runEverything' ? 'runEverything' : 'allowlist';
  }

  public async setMode(mode: WritePermissionMode): Promise<void> {
    await vscode.workspace
      .getConfiguration('localCodingAI')
      .update('writePermissionMode', mode, vscode.ConfigurationTarget.Global);
  }

  public getAllowlist(): string[] {
    const raw =
      vscode.workspace.getConfiguration('localCodingAI').get<string[]>('writeAllowlist') || [];
    const seen = new Set<string>();
    const cleaned: string[] = [];
    for (const entry of raw) {
      const value = String(entry || '')
        .trim()
        .toLowerCase();
      if (!value || seen.has(value)) {
        continue;
      }
      seen.add(value);
      cleaned.push(value);
    }
    return cleaned;
  }

  public isAllowed(actionType: string): boolean {
    if (this.getMode() === 'runEverything') {
      return true;
    }
    return isWriteActionAllowlisted(actionType, this.getAllowlist());
  }

  public async addToAllowlist(actionType: string): Promise<string[]> {
    const normalized = actionType.trim().toLowerCase();
    if (!normalized) {
      return this.getAllowlist();
    }
    const next = [...this.getAllowlist()];
    if (!next.includes(normalized)) {
      next.push(normalized);
      next.sort();
      await vscode.workspace
        .getConfiguration('localCodingAI')
        .update('writeAllowlist', next, vscode.ConfigurationTarget.Global);
    }
    return next;
  }

  public async removeFromAllowlist(actionType: string): Promise<string[]> {
    const normalized = actionType.trim().toLowerCase();
    const next = this.getAllowlist().filter((entry) => entry !== normalized);
    await vscode.workspace
      .getConfiguration('localCodingAI')
      .update('writeAllowlist', next, vscode.ConfigurationTarget.Global);
    return next;
  }

  public async clearAllowlist(): Promise<void> {
    await vscode.workspace
      .getConfiguration('localCodingAI')
      .update('writeAllowlist', [], vscode.ConfigurationTarget.Global);
  }

  /**
   * When mode is Allowlist and the action type is not listed, prompt the user.
   * Run = allow once. Add to Allowlist = persist type, then allow.
   */
  public async requestPermission(actionType: string, detail?: string): Promise<boolean> {
    if (this.isAllowed(actionType)) {
      return true;
    }

    const label = describeWriteAction(actionType);
    const lines = [
      `Allow write action: ${label}?`,
      '',
      'Run — allow once; ask again next time.',
      'Add to Allowlist — always allow this action type.',
    ];
    if (detail) {
      lines.push('', detail);
    }

    const choice = await vscode.window.showWarningMessage(
      lines.join('\n'),
      { modal: true },
      'Run',
      'Add to Allowlist',
      'Cancel'
    );

    if (choice === 'Run') {
      return true;
    }
    if (choice === 'Add to Allowlist') {
      await this.addToAllowlist(actionType);
      vscode.window.showInformationMessage(`Added "${label}" to the write allowlist.`);
      return true;
    }
    return false;
  }

  public async showManageAllowlistQuickPick(): Promise<void> {
    const mode = this.getMode();
    const allowlist = this.getAllowlist();

    const items: (vscode.QuickPickItem & { id: string })[] = [
      {
        id: 'mode-allowlist',
        label: mode === 'allowlist' ? '$(check) Mode: Allowlist' : 'Mode: Allowlist',
        description: 'Approve each write action type unless allowlisted',
      },
      {
        id: 'mode-runEverything',
        label: mode === 'runEverything' ? '$(check) Mode: Run everything' : 'Mode: Run everything',
        description: 'No permission prompts for write actions',
      },
      {
        id: 'sep',
        label: 'Allowlisted action types',
        kind: vscode.QuickPickItemKind.Separator,
      },
    ];

    if (allowlist.length === 0) {
      items.push({
        id: 'empty',
        label: '(none yet)',
        description: 'Approve an action with “Add to Allowlist” to populate this list',
      });
    } else {
      for (const entry of allowlist) {
        items.push({
          id: `remove:${entry}`,
          label: describeWriteAction(entry),
          description: entry,
          detail: 'Select to remove from allowlist',
        });
      }
      items.push({
        id: 'clear',
        label: '$(trash) Clear entire allowlist',
      });
    }

    const picked = await vscode.window.showQuickPick(items, {
      title: 'AI Write Permissions',
      placeHolder: 'Choose mode or manage allowlisted action types',
    });
    if (!picked || picked.id === 'empty' || picked.id === 'sep') {
      return;
    }
    if (picked.id === 'mode-allowlist') {
      await this.setMode('allowlist');
      return;
    }
    if (picked.id === 'mode-runEverything') {
      await this.setMode('runEverything');
      return;
    }
    if (picked.id === 'clear') {
      await this.clearAllowlist();
      vscode.window.showInformationMessage('Write allowlist cleared.');
      return;
    }
    if (picked.id.startsWith('remove:')) {
      const actionType = picked.id.slice('remove:'.length);
      await this.removeFromAllowlist(actionType);
      vscode.window.showInformationMessage(
        `Removed "${describeWriteAction(actionType)}" from allowlist.`
      );
    }
  }
}
