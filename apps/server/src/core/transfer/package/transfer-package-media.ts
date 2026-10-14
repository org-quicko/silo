import { FsLayout } from "../../../adapters/storage/fs/fs-layout";
import type { Entry } from "../../domain/entry";
import { Scope } from "../../domain/scope";
import { MediaCatalog } from "../../media/media-catalog";
import { MediaPaths } from "../../media/media-paths";
import type { BlobStorage } from "../../ports/blob-storage";
import type { Storage } from "../../ports/storage";
import { ExportEntryFile } from "../export-entry-file";
import { ExportMarker } from "../export-marker";
import type { ExportSink } from "../sink/export-sink";

/**
 * The media a package's entries use, and nothing else (D108): each active
 * asset they reference with its bytes, and the folder records above those
 * assets. Folder moves never ride.
 *
 * "Referenced" is `MediaRefs.extract`'s answer, legacy blob tokens included,
 * the same rule the archive's `referenced` mode uses (§7.7).
 */
export class TransferPackageMedia {
  private static readonly PageSize = 100;

  private readonly store: Storage;
  private readonly sink: ExportSink;
  private readonly blobStorage: BlobStorage;

  /** Tokens a carried asset answers for. */
  private readonly resolved = new Set<string>();
  /** Every folder above a carried asset. */
  private readonly ancestors = new Set<string>();
  private assets = 0;
  private folders = 0;

  constructor(store: Storage, sink: ExportSink, blobStorage: BlobStorage) {
    this.store = store;
    this.sink = sink;
    this.blobStorage = blobStorage;
  }

  /** Writes the closure of `referenced` and answers what it carried and missed. */
  async write(referenced: ReadonlySet<string>): Promise<{ assets: number; folders: number; missing: string[] }> {
    if (referenced.size > 0) {
      await this.eachRow(MediaCatalog.Collection, (row) => this.writeAsset(row, referenced));
    }
    if (this.ancestors.size > 0) {
      await this.eachRow(MediaCatalog.FoldersCollection, (row) => this.writeFolder(row));
    }
    const missing = [...referenced].filter((token) => !this.resolved.has(token)).sort();
    return { assets: this.assets, folders: this.folders, missing };
  }

  /** An asset rides when something points at it, it is active, and its bytes are there. */
  private async writeAsset(row: Entry, referenced: ReadonlySet<string>): Promise<void> {
    const asset = MediaCatalog.toAsset(row);
    const tokens = MediaCatalog.tokens(row.id, asset.blob_key);
    if (!tokens.some((token) => referenced.has(token)) || asset.state !== "active") return;

    const blob = await this.blobStorage.get(asset.blob_key);
    if (!blob) return;
    await this.sink.file(`media/${MediaPaths.archiveName(asset.blob_key)}`, blob.data);
    await this.writeRow(MediaCatalog.Collection, row, this.assets === 0);
    this.assets++;
    for (const token of tokens) this.resolved.add(token);
    for (const folder of MediaPaths.ancestors(asset.folder)) this.ancestors.add(folder);
  }

  private async writeFolder(row: Entry): Promise<void> {
    if (!this.ancestors.has(MediaCatalog.folderOf(row))) return;
    await this.writeRow(MediaCatalog.FoldersCollection, row, this.folders === 0);
    this.folders++;
  }

  /** The collection's schema and marker go out before its first row, and only then. */
  private async writeRow(collection: string, row: Entry, first: boolean): Promise<void> {
    if (first) {
      const record = (await this.store.findCollection(Scope.System, collection))!;
      const directory = `projects/${Scope.System.project}/${Scope.System.env}/schemas`;
      await this.sink.text(
        `${directory}/${collection}${FsLayout.SchemaSuffix}`,
        JSON.stringify(record.schema, null, 2)
      );
      await this.sink.text(
        `${directory}/.${collection}${FsLayout.CollectionMarkerSuffix}`,
        ExportMarker.text(record.id, record.created_at)
      );
    }
    await this.sink.text(ExportEntryFile.path(Scope.System, collection, row.id), ExportEntryFile.text(row));
  }

  private async eachRow(collection: string, visit: (row: Entry) => Promise<void>): Promise<void> {
    for (let offset = 0; ; offset += TransferPackageMedia.PageSize) {
      const { items } = await this.store.list(Scope.System, collection, {
        sort: [{ path: "$.id", desc: false }],
        limit: TransferPackageMedia.PageSize,
        offset,
      });
      if (items.length === 0) return;
      for (const row of items) await visit(row);
    }
  }
}
