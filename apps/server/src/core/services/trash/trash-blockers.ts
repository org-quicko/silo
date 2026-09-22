import type { Entry } from "../../domain/entry";
import type { Storage } from "../../ports/storage";
import type { TrashReceipt } from "../../trash/trash-receipt";
import type { TrashBlocker } from "../../trash/trash-view";
import { TrashLocator } from "./trash-locator";

/**
 * Whether a receipt can go back where it came from, and what is in the way
 * (D91).
 *
 * Restoring into a container that no longer exists would orphan the content —
 * Drive's known weak spot — so a missing container blocks the restore and is
 * named instead. Media never blocks: an asset's folder is a path, and writing
 * it recreates the folder.
 */
export class TrashBlockers {
  private readonly locator: TrashLocator;
  /** Receipt id by the subject id it would bring back, so a blocker can point
   *  at the receipt that unblocks it. */
  private readonly bySubject: Map<string, string>;

  constructor(store: Storage, receipts: readonly Entry[]) {
    this.locator = new TrashLocator(store);
    this.bySubject = new Map(
      receipts.map((entry) => [(entry.data as TrashReceipt).subject_id, entry.id])
    );
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

  private blocker(
    kind: TrashBlocker["kind"],
    name: string | undefined,
    id: string
  ): TrashBlocker {
    return { kind, name: name ?? id, trash_id: this.bySubject.get(id) ?? null };
  }
}
