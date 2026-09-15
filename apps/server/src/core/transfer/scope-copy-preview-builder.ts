import type { ScopeCopyCollectionPreview } from "./scope-copy-collection-preview";
import type { ScopeCopyPreviewEntry } from "./scope-copy-preview-entry";
import type { ScopeCopyPreview } from "./scope-copy-preview";
import type { ImportOptions } from "./import-options";

/** Builds one bounded page while preserving the complete change count. */
export class ScopeCopyPreviewBuilder {
  private readonly collections = new Map<string, ScopeCopyCollectionPreview>();
  private readonly entries: ScopeCopyPreviewEntry[] = [];
  private total = 0;

  private constructor(
    private readonly offset: number,
    private readonly limit: number,
  ) {}

  static from(options: ImportOptions): ScopeCopyPreviewBuilder | undefined {
    const details = options.dryRun ? options.scopeCopyPreview : undefined;
    return details ? new ScopeCopyPreviewBuilder(details.offset, details.limit) : undefined;
  }

  collection(name: string): ScopeCopyCollectionPreview {
    let summary = this.collections.get(name);
    if (!summary) {
      summary = { collection: name, schema: "unchanged", added: 0, updated: 0, deleted: 0, skipped: 0 };
      this.collections.set(name, summary);
    }
    return summary;
  }

  schema(collection: string, action: ScopeCopyCollectionPreview["schema"]): void {
    this.collection(collection).schema = action;
  }

  entriesFor(collection: string, action: ScopeCopyPreviewEntry["action"], ids: Array<string | undefined>): void {
    const summary = this.collection(collection);
    summary[action] += ids.length;
    for (const id of ids) {
      if (this.total >= this.offset && this.entries.length < this.limit) {
        this.entries.push({ collection, id, action });
      }
      this.total++;
    }
  }

  repeated(collection: string, action: ScopeCopyPreviewEntry["action"], count: number): void {
    const summary = this.collection(collection);
    summary[action] += count;
    const pageStart = Math.max(this.total, this.offset);
    const pageEnd = Math.min(this.total + count, this.offset + this.limit);
    for (let index = pageStart; index < pageEnd; index++) {
      this.entries.push({ collection, action });
    }
    this.total += count;
  }

  result(): ScopeCopyPreview {
    return {
      collections: [...this.collections.values()].sort((left, right) => left.collection.localeCompare(right.collection)),
      entries: this.entries,
      total: this.total,
      offset: this.offset,
      limit: this.limit,
    };
  }

  /** Whether a destination read can contribute an id to this response page. */
  needsIds(count: number): boolean {
    return this.total < this.offset + this.limit && this.total + count > this.offset;
  }

  position(): number {
    return this.total;
  }
}
