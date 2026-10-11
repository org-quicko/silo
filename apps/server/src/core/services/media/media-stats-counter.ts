import { MediaCatalog } from "../../media/media-catalog";
import { MediaKind, type MediaKindName } from "../../media/media-kind";
import { MediaPaths } from "../../media/media-paths";
import type { MediaStats } from "../../media/media-stats";
import type { MediaCatalogStore } from "./media-catalog-store";

/** Totals the catalog in one pass. Reads records only, never a blob. */
export class MediaStatsCounter {
  private readonly catalog: MediaCatalogStore;

  constructor(catalog: MediaCatalogStore) {
    this.catalog = catalog;
  }

  async count(): Promise<MediaStats> {
    const folders = new Set<string>();
    const kinds = new Map<MediaKindName, { files: number; bytes: number }>();
    const stats: MediaStats = { files: 0, bytes: 0, folders: 0, types: [], largest: null, last_upload: null, deleting: 0 };
    let lastUpload = 0;

    for (const entry of await this.catalog.allFolders()) {
      for (const path of MediaPaths.ancestors(MediaCatalog.folderOf(entry))) folders.add(path);
    }
    for (const entry of await this.catalog.allAssets()) {
      const asset = MediaCatalog.toAsset(entry);
      if (asset.state === "deleting") {
        stats.deleting++;
        continue;
      }
      for (const path of MediaPaths.ancestors(asset.folder)) folders.add(path);
      stats.files++;
      stats.bytes += asset.size;

      const kind = MediaKind.of(asset.content_type);
      const totals = kinds.get(kind) ?? { files: 0, bytes: 0 };
      totals.files++;
      totals.bytes += asset.size;
      kinds.set(kind, totals);

      if (!stats.largest || asset.size > stats.largest.size) {
        stats.largest = { id: entry.id, filename: asset.filename, folder: asset.folder, size: asset.size };
      }
      const created = new Date(entry.created_at).getTime();
      if (created > lastUpload) lastUpload = created;
    }

    stats.folders = folders.size;
    stats.types = [...kinds]
      .map(([type, totals]) => ({ type, ...totals }))
      .sort((left, right) => right.bytes - left.bytes || right.files - left.files);
    stats.last_upload = lastUpload > 0 ? new Date(lastUpload).toISOString() : null;
    return stats;
  }
}
