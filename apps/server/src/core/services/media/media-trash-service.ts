import type { Entry } from "../../domain/entry";
import { MediaInUseError } from "../../errors/media-in-use-error";
import { NotFoundError } from "../../errors/not-found-error";
import { MediaCatalog } from "../../media/media-catalog";
import type { DeleteOptions } from "../../trash/delete-options";
import { DeleteOptionsUtils } from "../../trash/delete-options";
import type { ServiceContext } from "../support/service-context";
import type { TrashService } from "../trash/trash-service";
import type { MediaCatalogStore } from "./media-catalog-store";
import { MediaFolderService } from "./media-folder-service";
import type { MediaFolderTrashOutcome } from "./media-folder-trash-outcome";

/**
 * Deleting an asset or a folder into the trash instead of destroying it (D113).
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
  private readonly folders: MediaFolderService;
  private readonly trash: TrashService;

  constructor(
    context: ServiceContext,
    catalog: MediaCatalogStore,
    folders: MediaFolderService,
    trash: TrashService
  ) {
    this.context = context;
    this.catalog = catalog;
    this.folders = folders;
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
      const entry = await this.claim(id, options.force === true);
      const receipt = await this.trash.capture.asset(
        entry,
        DeleteOptionsUtils.actorOf(options),
        this.trash.expiryStamp()
      );
      await this.catalog.deleteAsset(id);
      return receipt;
    });
  }

  /**
   * A folder, the folders beneath it and the assets `ids` names, as one
   * receipt. An asset that cannot go is reported and stays, and then so do the
   * folder records, since the folder is not gone.
   */
  async moveFolderToTrash(
    folderPath: unknown,
    ids: readonly string[],
    options: { force?: boolean } & DeleteOptions
  ): Promise<MediaFolderTrashOutcome> {
    const folder = MediaFolderService.require(folderPath);
    return this.context.withWriteLock(async () => {
      const assets: Entry[] = [];
      const failed: MediaFolderTrashOutcome["failed"] = [];
      for (const id of ids) {
        try {
          assets.push(await this.claim(id, options.force === true));
        } catch (error) {
          // Anything else fails the whole request before a receipt exists.
          if (!(error instanceof MediaInUseError || error instanceof NotFoundError)) throw error;
          failed.push({ id, error });
        }
      }

      // An asset that was already gone does not keep the folder.
      const emptied = failed.every(({ error }) => error instanceof NotFoundError);
      const records = emptied ? await this.folders.recordsWithin(folder) : [];
      const trashId = await this.park(folder, assets, records, options);
      return {
        deleted: assets.map((entry) => entry.id),
        failed,
        foldersDeleted: records.length,
        trashId,
      };
    });
  }

  /** An empty folder and the empty folders beneath it, as one receipt. Null
   *  when the path had no record to park. */
  async moveEmptyFolderToTrash(folderPath: unknown, options: DeleteOptions): Promise<string | null> {
    const folder = MediaFolderService.require(folderPath);
    return this.context.withWriteLock(async () => {
      await this.folders.requireEmpty(folder);
      return this.park(folder, [], await this.folders.recordsWithin(folder), options);
    });
  }

  /** Parks, then drops, so a crash in between leaves the live records whole. */
  private async park(
    folder: string,
    assets: readonly Entry[],
    records: readonly Entry[],
    options: DeleteOptions
  ): Promise<string | null> {
    if (assets.length === 0 && records.length === 0) return null;
    const receipt = await this.trash.capture.folder(
      folder,
      assets,
      records,
      DeleteOptionsUtils.actorOf(options),
      this.trash.expiryStamp()
    );
    for (const entry of assets) await this.catalog.deleteAsset(entry.id);
    for (const entry of records) await this.catalog.deleteFolder(entry.id);
    return receipt;
  }

  /** The asset's document, unless a live reference still needs it. */
  private async claim(id: string, force: boolean): Promise<Entry> {
    const entry = await this.catalog.asset(id);
    if (!force) {
      const tokens = MediaCatalog.tokens(entry.id, MediaCatalog.toAsset(entry).blob_key);
      const usage = await this.context.store.listMediaUsages(tokens, { limit: 0 });
      if (usage.total > 0) throw new MediaInUseError(id, usage.total);
    }
    return entry;
  }
}
