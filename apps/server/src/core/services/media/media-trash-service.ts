import { MediaInUseError } from "../../errors/media-in-use-error";
import { MediaCatalog } from "../../media/media-catalog";
import type { DeleteOptions } from "../../trash/delete-options";
import { DeleteOptionsUtils } from "../../trash/delete-options";
import type { ServiceContext } from "../support/service-context";
import type { TrashService } from "../trash/trash-service";
import type { MediaCatalogStore } from "./media-catalog-store";

/**
 * Deleting an asset into the trash instead of destroying it (D91).
 *
 * Not the deletion saga with a flag: that saga exists to get the blob and the
 * catalog record to agree, and the trash needs the opposite — the record goes,
 * the bytes stay, and only a purge takes them. So the record is parked and
 * dropped, and no `deleting` state is ever entered.
 *
 * The usage check is unchanged. An asset the trash holds is still an asset the
 * entries referencing it can no longer resolve, so being recoverable is not a
 * reason to break a live reference quietly.
 */
export class MediaTrashService {
  private readonly context: ServiceContext;
  private readonly catalog: MediaCatalogStore;
  private readonly trash: TrashService;

  constructor(context: ServiceContext, catalog: MediaCatalogStore, trash: TrashService) {
    this.context = context;
    this.catalog = catalog;
    this.trash = trash;
  }

  /** Whether this delete should go to the trash rather than to the saga. */
  handles(options: DeleteOptions | undefined): boolean {
    return this.trash.enabled && !DeleteOptionsUtils.isPermanent(options);
  }

  async moveToTrash(
    id: string,
    options: { force?: boolean } & DeleteOptions
  ): Promise<string | null> {
    return this.context.withWriteLock(async () => {
      const entry = await this.catalog.asset(id);
      const asset = MediaCatalog.toAsset(entry);

      if (options.force !== true) {
        const tokens = MediaCatalog.tokens(entry.id, asset.blob_key);
        const usage = await this.context.store.listMediaUsages(tokens, { limit: 0 });
        if (usage.total > 0) throw new MediaInUseError(id, usage.total);
      }

      const receipt = await this.trash.capture.asset(
        entry,
        DeleteOptionsUtils.actorOf(options),
        this.trash.expiryStamp()
      );
      await this.catalog.deleteAsset(id);
      return receipt;
    });
  }
}
