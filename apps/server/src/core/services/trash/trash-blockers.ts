import type { Entry } from "../../domain/entry";
import type { TrashReceipt } from "../../trash/trash-receipt";
import type { TrashBlocker } from "../../trash/trash-view";
import type { TrashLocator } from "./trash-locator";

/**
 * Whether a receipt can go back where it came from, and what is in the way
 * (D113).
 *
 * Restoring into a container that no longer exists would orphan the content —
 * Drive's known weak spot — so a missing container blocks the restore and is
 * named instead. Media never blocks: an asset's folder is a path, and writing
 * it recreates the folder.
 */
export class TrashBlockers {
  private readonly locator: TrashLocator;
  /** The receipt that would bring a container back, so a blocker can point
   *  at the receipt that unblocks it. */
  private readonly receiptFor: (subjectId: string) => Promise<string | null>;

  /** `locator` is shared with the caller's name lookups, so one list reads
   *  each container table once. */
  constructor(locator: TrashLocator, receiptFor: (subjectId: string) => Promise<string | null>) {
    this.locator = locator;
    this.receiptFor = receiptFor;
  }

  /** A lookup over receipts already read, newest first, so the newest wins. */
  static bySubject(receipts: readonly Entry[]): (subjectId: string) => Promise<string | null> {
    const ids = new Map<string, string>();
    for (const entry of receipts) {
      const subject = (entry.data as TrashReceipt).subject_id;
      if (!ids.has(subject)) ids.set(subject, entry.id);
    }
    return async (subjectId) => ids.get(subjectId) ?? null;
  }

  async blockerFor(receipt: TrashReceipt): Promise<TrashBlocker | undefined> {
    const { origin } = receipt;
    if (receipt.kind === "entry" && origin.project_id && origin.env_id && origin.collection_id) {
      const name = await this.locator.collectionName(
        origin.project_id,
        origin.env_id,
        origin.collection_id
      );
      if (!name) return this.blocker("collection", origin.collection_name, origin.collection_id);
    }
    if (receipt.kind === "collection" && origin.project_id && origin.env_id) {
      const scope = await this.locator.scopeOf(origin.project_id, origin.env_id);
      if (!scope) return this.blocker("environment", origin.env_name, origin.env_id);
    }
    if (receipt.kind === "environment" && origin.project_id) {
      const name = await this.locator.projectName(origin.project_id);
      if (!name) return this.blocker("project", origin.project_name, origin.project_id);
    }
    return undefined;
  }

  private async blocker(
    kind: TrashBlocker["kind"],
    name: string | undefined,
    id: string
  ): Promise<TrashBlocker> {
    return { kind, name: name ?? id, trash_id: await this.receiptFor(id) };
  }
}
