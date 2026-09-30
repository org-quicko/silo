import type { Entry } from "../../domain/entry";
import { ArchiveTooLargeError } from "../../errors/archive-too-large-error";
import { NotFoundError } from "../../errors/not-found-error";
import type { MediaAsset } from "../../media/media-asset";
import { MediaArchiveLimits, type MediaDownloadCeilings } from "../../media/media-archive-limits";
import { MediaArchiveNames } from "../../media/media-archive-names";
import type { MediaArchiveFile, MediaArchivePart, MediaArchivePlan } from "../../media/media-archive-plan";
import type { MediaArchiveSelection } from "../../media/media-archive-selection";
import { MediaCatalog } from "../../media/media-catalog";
import { MediaPaths } from "../../media/media-paths";
import type { MediaCatalogStore } from "./media-catalog-store";

interface Catalogued {
  entry: Entry;
  asset: MediaAsset;
}

/**
 * Resolves a selection to the files a bulk download holds and splits them
 * into parts (D106). A selected folder keeps its name and its tree, empty
 * subfolders included; a selected file lands at the archive root.
 */
export class MediaArchivePlanner {
  private readonly catalog: MediaCatalogStore;

  constructor(catalog: MediaCatalogStore) {
    this.catalog = catalog;
  }

  async plan(
    selection: MediaArchiveSelection,
    ceilings: MediaDownloadCeilings,
    now: Date = new Date()
  ): Promise<MediaArchivePlan> {
    const assets: Catalogued[] = (await this.catalog.allAssets()).map((entry) => ({
      entry,
      asset: MediaCatalog.toAsset(entry),
    }));
    const folderRecords = (await this.catalog.allFolders()).map((entry) => MediaCatalog.folderOf(entry));
    const names = new MediaArchiveNames();
    const files: MediaArchiveFile[] = [];
    const directories: string[] = [];
    const included = new Set<string>();

    const include = ({ entry, asset }: Catalogued, path: string) => {
      included.add(entry.id);
      files.push({ id: entry.id, path: names.claim(path), size: asset.size, modified: MediaArchivePlanner.modified(entry) });
    };

    for (const folder of selection.folders) {
      const inside = assets
        .filter(({ asset }) => asset.state === "active" && MediaPaths.isWithin(asset.folder, folder))
        .sort(MediaArchivePlanner.byPath);
      const subfolders = folderRecords.filter((path) => MediaPaths.isWithin(path, folder));
      if (inside.length === 0 && subfolders.length === 0) throw new NotFoundError(`folder "${folder}" not found`);

      const root = names.claim(MediaArchivePlanner.leaf(folder));
      for (const item of inside) {
        if (!included.has(item.entry.id)) include(item, `${root}${item.asset.folder.slice(folder.length)}/${item.asset.filename}`);
      }
      for (const path of [...new Set([folder, ...subfolders])].sort()) {
        if (!inside.some(({ asset }) => MediaPaths.isWithin(asset.folder, path))) {
          directories.push(`${root}${path.slice(folder.length)}/`);
        }
      }
    }

    const byId = new Map(assets.map((item) => [item.entry.id, item]));
    for (const id of selection.ids) {
      if (included.has(id)) continue;
      const item = byId.get(id);
      if (!item) throw new NotFoundError(`media asset "${id}" not found`);
      if (item.asset.state === "active") include(item, item.asset.filename);
    }

    const bytes = files.reduce((sum, file) => sum + file.size, 0);
    MediaArchivePlanner.assertWithin(ceilings, files.length, bytes);

    const name =
      selection.folders.length === 1 && selection.ids.length === 0
        ? MediaArchivePlanner.leaf(selection.folders[0])
        : `media-${MediaArchivePlanner.stamp(now)}`;
    const fits = (file: MediaArchiveFile) => file.size <= MediaArchiveLimits.PartBytes;

    return {
      files: files.length,
      bytes,
      parts: MediaArchivePlanner.split(files.filter(fits), directories, name),
      separate: files
        .filter((file) => !fits(file))
        .map((file) => ({ id: file.id, filename: MediaArchivePlanner.leaf(file.path), size: file.size })),
    };
  }

  /** Greedy, in archive order, so a folder's files stay together where they fit. */
  private static split(files: MediaArchiveFile[], directories: string[], name: string): MediaArchivePart[] {
    const parts: MediaArchivePart[] = [];
    const open = () => {
      const part: MediaArchivePart = { filename: "", files: [], directories: [], bytes: 0 };
      parts.push(part);
      return part;
    };
    for (const file of files) {
      let part = parts[parts.length - 1];
      if (!part || part.bytes + file.size > MediaArchiveLimits.PartBytes) part = open();
      part.files.push(file);
      part.bytes += file.size;
    }
    if (directories.length > 0) (parts[0] ?? open()).directories = directories;
    parts.forEach((part, index) => {
      part.filename = parts.length === 1 ? `${name}.zip` : `${name}-${index + 1}-of-${parts.length}.zip`;
    });
    return parts;
  }

  private static assertWithin(ceilings: MediaDownloadCeilings, files: number, bytes: number): void {
    const size = (value: number) =>
      value >= 1024 ** 3 ? `${(value / 1024 ** 3).toFixed(1)} GB` : `${Math.ceil(value / 1024 ** 2)} MB`;
    const over =
      files > ceilings.maxFiles
        ? { what: `${files} files`, most: `${ceilings.maxFiles} files`, setting: "download_max_files" }
        : bytes > ceilings.maxBytes
          ? { what: size(bytes), most: size(ceilings.maxBytes), setting: "download_max_size_mb" }
          : null;
    if (!over) return;
    throw new ArchiveTooLargeError(
      `this download holds ${over.what}, and the most is ${over.most}. ` +
        `Select less, or raise [media] ${over.setting} in the media library settings.`
    );
  }

  private static byPath(left: Catalogued, right: Catalogued): number {
    if (left.asset.folder !== right.asset.folder) return left.asset.folder < right.asset.folder ? -1 : 1;
    return left.asset.filename.localeCompare(right.asset.filename);
  }

  private static leaf(path: string): string {
    return path.slice(path.lastIndexOf("/") + 1);
  }

  private static modified(entry: Entry): Date {
    return entry.updated_at instanceof Date ? entry.updated_at : new Date(entry.updated_at);
  }

  private static stamp(now: Date): string {
    return now.toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
  }
}
