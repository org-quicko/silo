import { ValidationError } from "@silo/shared/validation-error";
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
   * Removes the explicit record. Refuses while any asset still names the folder
   * or one beneath it — deleting a folder must never be a way to delete the
   * files in it, which would route around the reference guard.
   */
  async delete(folderPath: unknown): Promise<void> {
    const normalized = MediaFolderService.require(folderPath);

    await this.context.withWriteLock(async () => {
      const occupied = (await this.catalog.allAssets()).filter((entry) =>
        MediaPaths.isWithin(MediaCatalog.toAsset(entry).folder, normalized)
      ).length;
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
