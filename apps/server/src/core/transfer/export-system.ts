import type { Entry } from "../domain/entry";
import { Scope } from "../domain/scope";
import { SystemCollections } from "../domain/system-collections";
import type { KeyInfo } from "../keys/key-info";
import { KeyUtils } from "../keys/key-utils";
import { MediaCatalog } from "../media/media-catalog";
import { MediaRef } from "@silo/shared/media-ref";
import { MediaModes, type MediaMode } from "./media-mode";
import type { Storage } from "../ports/storage";
import { VariableRecords } from "../variables/variable-record";
import { FsLayout } from "../../adapters/storage/fs/fs-layout";
import { ExportEntryFile } from "./export-entry-file";
import { ExportMarker } from "./export-marker";
import type { ExportSink } from "./sink/export-sink";

/**
 * The `_system` half of an export: the media catalog, its folders, the
 * variable declarations, and — only behind `with_keys` — the key hashes.
 *
 * It runs after `ExportWalk` because two of its filters depend on what that
 * walk found: which assets the exported entries reference, and which projects
 * were written at all. See §7.7 in
 * [docs/design/transfer.md](../../../../../docs/design/transfer.md).
 */
export class ExportSystem {
  private static readonly PageSize = 100;

  private readonly store: Storage;
  private readonly sink: ExportSink;
  private readonly media: MediaMode;
  private readonly withKeys: boolean;
  private readonly projectIds: ReadonlySet<string>;
  private readonly referenced: ReadonlySet<string>;

  readonly counts: Record<string, number> = {};
  /** Blob keys of the catalog rows this archive carries, in write order. */
  readonly blobKeys: string[] = [];
  /** Distinct assets the exported entries point at, carried or not. */
  referencedAssets = 0;

  constructor(options: {
    store: Storage;
    sink: ExportSink;
    media: MediaMode;
    withKeys: boolean;
    projectIds: ReadonlySet<string>;
    referenced: ReadonlySet<string>;
  }) {
    this.store = options.store;
    this.sink = options.sink;
    this.media = options.media;
    this.withKeys = options.withKeys;
    this.projectIds = options.projectIds;
    this.referenced = options.referenced;
  }

  async write(): Promise<void> {
    const records = (await this.store.listCollections(Scope.System)).sort((left, right) =>
      left.name.localeCompare(right.name)
    );

    for (const record of records) {
      if (!this.rides(record.name)) continue;
      // The schema rides even for a system collection holding nothing: a
      // `content/<name>/` directory with no schema beside it is refused on the
      // way back in (D51), so writing the entries without it would produce an
      // archive silo cannot read.
      const directory = `projects/${Scope.System.project}/${Scope.System.env}/schemas`;
      await this.sink.text(
        `${directory}/${record.name}${FsLayout.SchemaSuffix}`,
        JSON.stringify(record.schema, null, 2)
      );
      await this.sink.text(
        `${directory}/.${record.name}${FsLayout.CollectionMarkerSuffix}`,
        ExportMarker.text(record.id, record.created_at)
      );
      this.counts[`${Scope.System.key()}/${record.name}`] = await this.writeCollection(record.name);
    }
  }

  /**
   * Which system collections are in an archive at all.
   *
   * `_keys` is the only credential and the only one gated. The media catalog
   * and the variables are data — an archive carrying media bytes without their
   * filenames restores a library with no organisation, and one carrying
   * `{{API_URL}}` without its declaration restores content whose references
   * have quietly stopped resolving (D23, D57). Everything else silo keeps for
   * itself — audit, plugins, scope renames — is instance-local and never rides.
   */
  private rides(collection: string): boolean {
    if (collection === KeyUtils.KeysCollection) return this.withKeys;
    return (
      collection === SystemCollections.Media ||
      collection === SystemCollections.MediaFolders ||
      collection === SystemCollections.MediaFolderMoves ||
      collection === SystemCollections.Variables
    );
  }

  private async writeCollection(collection: string): Promise<number> {
    let offset = 0;
    let count = 0;
    for (;;) {
      const { items } = await this.store.list(Scope.System, collection, {
        sort: [{ path: "$.id", desc: false }],
        limit: ExportSystem.PageSize,
        offset,
      });
      if (items.length === 0) return count;

      for (const entry of items) {
        if (!this.keeps(collection, entry)) continue;
        await this.sink.text(
          ExportEntryFile.path(Scope.System, collection, entry.id),
          ExportEntryFile.text(entry)
        );
        if (collection === SystemCollections.Media) {
          this.blobKeys.push(MediaCatalog.toAsset(entry).blob_key);
        }
        count++;
      }
      offset += items.length;
    }
  }

  /** Which rows of a riding collection ride. */
  private keeps(collection: string, entry: Entry): boolean {
    if (collection === KeyUtils.KeysCollection) {
      // A managed key is minted, kept and rotated by silo itself, so a copy of
      // it at the destination authenticates as nothing and is revocable through
      // no ordinary path (D34). The destination mints its own on approval.
      return !KeyUtils.isManaged(entry.data as KeyInfo);
    }
    if (collection === SystemCollections.Variables) {
      // Keyed by project id, so a selective export carries exactly the
      // declarations its projects own.
      return this.projectIds.has(VariableRecords.from(entry.data).project_id);
    }
    if (collection === SystemCollections.Media) {
      return this.keepsAsset(entry);
    }
    // Folders and in-flight moves are structure, not content: they are tiny,
    // and dropping one an asset still names restores a library whose
    // organisation has silently collapsed into the root.
    return true;
  }

  /**
   * The media mode decides the catalog subset as well as the bytes, so the two
   * cannot disagree: `referenced` narrows both, `all` and `none` describe the
   * whole library and differ only in whether its bytes come along.
   */
  private keepsAsset(entry: Entry): boolean {
    const asset = MediaCatalog.toAsset(entry);
    const pointedAt =
      this.referenced.has(entry.id) || this.referenced.has(MediaRef.blobToken(asset.blob_key));
    if (pointedAt) this.referencedAssets++;
    return this.media === MediaModes.Referenced ? pointedAt : true;
  }
}
