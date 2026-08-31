import { ValidationError } from "@silo/shared/validation-error";
import type { Entry } from "../../domain/entry";
import { ConflictError } from "../../errors/conflict-error";
import { MediaCatalog } from "../../media/media-catalog";
import { MediaPaths } from "../../media/media-paths";
import type { ServiceContext } from "../support/service-context";
import type { MediaCatalogStore } from "./media-catalog-store";

/**
 * Media folders, which organise but do not authorise.
 *
 * D20's existence rule in both halves: a folder exists when it was created
 * explicitly (a `_media_folders` record) or when some asset names it. The
 * explicit half is what lets a folder be made before anything is filed into it.
 */
export class MediaFolderService {
  private readonly context: ServiceContext;
  private readonly catalog: MediaCatalogStore;

  constructor(context: ServiceContext, catalog: MediaCatalogStore) {
    this.context = context;
    this.catalog = catalog;
  }

  /** Every folder path, explicit or implied, including ancestors. */
  async list(): Promise<string[]> {
    const paths = new Set<string>();

    for (const entry of await this.catalog.allFolders()) {
      MediaFolderService.addWithAncestors(paths, MediaCatalog.folderOf(entry));
    }
    for (const entry of await this.catalog.allAssets()) {
      MediaFolderService.addWithAncestors(paths, MediaCatalog.toAsset(entry).folder);
    }

    return [...paths].sort();
  }

  /** Declares a folder. Idempotent: an existing path is returned unchanged. */
  async create(folderPath: unknown): Promise<string> {
    const normalized = MediaFolderService.require(folderPath);

    return this.context.withWriteLock(async () => {
      if (await this.catalog.folder(normalized)) return normalized;
      await this.catalog.putFolder(normalized);
      return normalized;
    });
  }

  /**
   * Removes the explicit record. Refuses while any asset still names the
   * folder or one beneath it.
   *
   * This is the non-recursive, default path, and it stays the trivial case:
   * an empty folder holds nothing a delete could break, so it needs no
   * `force` of its own. D23 read that refusal as absolute — deleting a folder
   * must never become a way to delete the files in it, since that would route
   * around the reference guard — but D48 already reversed the premise: the
   * guard is opt-in force, not absolute, everywhere else it applies. D49
   * makes the same choice available here, as `?recursive=true`
   * (`MediaFolderRoutes`, `assetsWithin`/`deleteRecordsWithin` below); this method
   * is what runs when that flag is absent, and its behaviour is unchanged.
   */
  async delete(folderPath: unknown): Promise<void> {
    const normalized = MediaFolderService.require(folderPath);

    await this.context.withWriteLock(async () => {
      const occupied = (await this.assetsWithin(normalized)).length;
      if (occupied > 0) {
        throw new ConflictError(
          `folder "${normalized}" still holds ${occupied} file${occupied === 1 ? "" : "s"}`
        );
      }

      for (const entry of await this.catalog.allFolders()) {
        if (MediaPaths.isWithin(MediaCatalog.folderOf(entry), normalized)) {
          await this.catalog.deleteFolder(entry.id);
        }
      }
    });
  }

  /**
   * Every asset document within `folderPath`'s subtree (itself included).
   *
   * Public for two callers outside this class: `MediaFolderRoutes`' recursive
   * folder delete, which needs the id list both for `RouteAuth.
   * requireForcedMediaDelete`'s authority check and for the delete loop
   * itself, before either runs — and `delete` above, which only needs the
   * count.
   */
  async assetsWithin(folderPath: unknown): Promise<Entry[]> {
    const normalized = MediaFolderService.require(folderPath);
    return (await this.catalog.allAssets()).filter((entry) =>
      MediaPaths.isWithin(MediaCatalog.toAsset(entry).folder, normalized)
    );
  }

  /**
   * Removes every explicit folder record at or beneath `folderPath` (itself
   * included), unconditionally.
   *
   * Called only once a recursive delete has confirmed every asset in the
   * subtree is actually gone (`MediaFolderRoutes`) — never on its own, and never
   * when anything remains: a record naming a subtree still holding an asset
   * must report that honestly rather than vanish out from under it.
   */
  async deleteRecordsWithin(folderPath: unknown): Promise<number> {
    const normalized = MediaFolderService.require(folderPath);

    return this.context.withWriteLock(async () => {
      let count = 0;
      for (const entry of await this.catalog.allFolders()) {
        if (MediaPaths.isWithin(MediaCatalog.folderOf(entry), normalized)) {
          await this.catalog.deleteFolder(entry.id);
          count++;
        }
      }
      return count;
    });
  }

  private static addWithAncestors(paths: Set<string>, folder: string): void {
    if (!folder) return;
    for (const ancestor of MediaPaths.ancestors(folder)) paths.add(ancestor);
  }

  private static require(folderPath: unknown): string {
    const normalized = MediaPaths.normalizeFolder(folderPath);
    if (!normalized) throw new ValidationError("folder path is required");
    return normalized;
  }
}
