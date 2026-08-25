import { MediaRef } from "@silo/shared/media-ref";
import { ValidationError } from "@silo/shared/validation-error";
import { ConflictError } from "../../errors/conflict-error";
import { NotFoundError } from "../../errors/not-found-error";
import { MediaCatalog } from "../../media/media-catalog";
import type { MediaCatalogStore } from "./media-catalog-store";

/**
 * Refuses a *new* reference to an asset that is being deleted, or to one that
 * does not exist at all.
 *
 * Called from the entry write path only — import does not run it, because §7.2
 * is fidelity-first and an archive must never be rejected for naming an asset
 * it also carries.
 */
export class MediaReferenceGuard {
  private readonly catalog: MediaCatalogStore;

  constructor(catalog: MediaCatalogStore) {
    this.catalog = catalog;
  }

  async assertReferencable(tokens: string[]): Promise<void> {
    for (const token of tokens) {
      // Pre-D23 references name a blob key rather than a catalog id; there is
      // no record to check.
      if (token.startsWith(MediaRef.BlobTokenPrefix)) continue;

      let entry;
      try {
        entry = await this.catalog.asset(token);
      } catch (error) {
        if (error instanceof NotFoundError) {
          throw new ValidationError(`media asset "${token}" does not exist`);
        }
        throw error;
      }

      if (MediaCatalog.toAsset(entry).state === "deleting") {
        throw new ConflictError(
          `media asset "${token}" is being deleted and cannot be referenced`
        );
      }
    }
  }
}
