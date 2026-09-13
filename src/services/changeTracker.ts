export interface FileChangeRecord {
  /** Workspace-relative path using forward slashes */
  path: string;
  /** Previous contents; null if the file did not exist before this batch */
  before: string | null;
  after: string;
  created: boolean;
}

export interface ChangeBatch {
  id: string;
  createdAt: number;
  files: Map<string, FileChangeRecord>;
}

export class ChangeTracker {
  private batches = new Map<string, ChangeBatch>();
  private activeBatchId: string | undefined;

  public startBatch(): string {
    const id = `batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.batches.set(id, {
      id,
      createdAt: Date.now(),
      files: new Map(),
    });
    this.activeBatchId = id;
    // Keep only the last 10 batches
    if (this.batches.size > 10) {
      const oldest = [...this.batches.keys()].sort(
        (a, b) => (this.batches.get(a)?.createdAt || 0) - (this.batches.get(b)?.createdAt || 0)
      )[0];
      if (oldest && oldest !== id) {
        this.batches.delete(oldest);
      }
    }
    return id;
  }

  public getActiveBatchId(): string | undefined {
    return this.activeBatchId;
  }

  public recordWrite(
    batchId: string,
    relPath: string,
    before: string | null,
    after: string
  ): void {
    const batch = this.batches.get(batchId);
    if (!batch) {
      return;
    }
    const key = relPath.replace(/\\/g, '/');
    const existing = batch.files.get(key);
    if (existing) {
      // Keep original before; update after
      existing.after = after;
      return;
    }
    batch.files.set(key, {
      path: key,
      before,
      after,
      created: before === null,
    });
  }

  public getBatch(batchId: string): ChangeBatch | undefined {
    return this.batches.get(batchId);
  }

  public listChangedPaths(batchId: string): string[] {
    const batch = this.batches.get(batchId);
    if (!batch) {
      return [];
    }
    return [...batch.files.keys()].sort();
  }

  public takeBatchForUndo(batchId: string): FileChangeRecord[] {
    const batch = this.batches.get(batchId);
    if (!batch) {
      return [];
    }
    const records = [...batch.files.values()];
    this.batches.delete(batchId);
    if (this.activeBatchId === batchId) {
      this.activeBatchId = undefined;
    }
    return records;
  }
}
