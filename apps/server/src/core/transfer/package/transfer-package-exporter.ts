import { FsLayout } from "../../../adapters/storage/fs/fs-layout";
import { SiloVersion } from "../../../version";
import type { CollectionRecord } from "../../domain/collection-record";
import type { Entry } from "../../domain/entry";
import { EntryUtils } from "../../domain/entry-utils";
import { NotFoundError } from "../../errors/not-found-error";
import { MediaRefs } from "../../media/media-refs";
import type { BlobStorage } from "../../ports/blob-storage";
import type { Storage } from "../../ports/storage";
import { ExportEntryFile } from "../export-entry-file";
import { ExportMarker } from "../export-marker";
import { MediaModes } from "../media-mode";
import type { ExportSink } from "../sink/export-sink";
import { TarExportSink } from "../sink/tar-export-sink";
import { GzipStream } from "../tar/gzip-stream";
import { TarWriter } from "../tar/tar-writer";
import { TransferPackageFormat } from "./transfer-package-format";
import type { TransferPackageManifest } from "./transfer-package-manifest";
import { TransferPackageMedia } from "./transfer-package-media";
import type { TransferPackagePlan } from "./transfer-package-plan";
import type { TransferPackageSelection } from "./transfer-package-selection";

/**
 * Writes a transfer package (D108): exactly the selected entries, their
 * collections' schemas, and with `referenced` media the assets those entries
 * use. Variables, keys and every other system row stay behind.
 *
 * `plan` runs before the response begins, so a name or id that does not exist
 * is a `404` and not a truncated body. An entry deleted between the two still
 * truncates it, which the destination refuses rather than half reads.
 */
export class TransferPackageExporter {
  private static readonly PageSize = 100;
  /** How many missing names a refusal spells out. */
  private static readonly Named = 10;

  static async plan(store: Storage, selection: TransferPackageSelection): Promise<TransferPackagePlan> {
    const { project, env } = selection.scope;
    const projectRecord = await store.findProject(project);
    const environment = projectRecord ? await store.findEnvironment(project, env) : null;
    if (!projectRecord || !environment) throw new NotFoundError(`environment "${project}/${env}" not found`);

    const missing: string[] = [];
    const collections: CollectionRecord[] = [];
    for (const item of selection.collections) {
      const record = await store.findCollection(selection.scope, item.name);
      if (!record) {
        missing.push(`collection "${item.name}"`);
        continue;
      }
      collections.push(record);
      for (const id of item.entryIds ?? []) {
        if (!(await TransferPackageExporter.exists(store, selection, item.name, id))) {
          missing.push(`entry "${item.name}/${id}"`);
        }
      }
    }
    if (missing.length > 0) {
      const named = missing.slice(0, TransferPackageExporter.Named).join(", ");
      const more = missing.length - Math.min(missing.length, TransferPackageExporter.Named);
      throw new NotFoundError(`not in ${project}/${env}: ${named}${more > 0 ? ` and ${more} more` : ""}`);
    }

    collections.sort((left, right) => left.name.localeCompare(right.name));
    return { selection, project: projectRecord, environment, collections };
  }

  /** The package as a gzipped tar stream, produced as it is written. */
  static stream(store: Storage, plan: TransferPackagePlan, blobStorage: BlobStorage): ReadableStream<Uint8Array> {
    const createdAt = EntryUtils.now();
    const gzip = new GzipStream();
    const tar = new TarWriter((chunk) => gzip.write(chunk), createdAt);

    void (async () => {
      try {
        await TransferPackageExporter.write(store, plan, new TarExportSink(tar), blobStorage, createdAt);
        await tar.finish();
        gzip.end();
      } catch (caught) {
        gzip.fail(caught);
      }
    })();
    return gzip.readable;
  }

  /** The walk, against any sink. Answers the manifest it wrote last. */
  static async write(
    store: Storage,
    plan: TransferPackagePlan,
    sink: ExportSink,
    blobStorage: BlobStorage,
    createdAt: Date
  ): Promise<TransferPackageManifest> {
    const { scope, media } = plan.selection;
    const directory = `projects/${scope.project}/${scope.env}`;
    await sink.text(
      `projects/${scope.project}/${FsLayout.ProjectMarker}`,
      ExportMarker.text(plan.project.id, plan.project.created_at)
    );
    await sink.text(
      `${directory}/${FsLayout.EnvMarker}`,
      ExportMarker.text(plan.environment.id, plan.environment.created_at)
    );

    const referenced = new Set<string>();
    const collections: TransferPackageManifest["collections"] = [];
    for (const record of plan.collections) {
      await sink.text(`${directory}/schemas/${record.name}${FsLayout.SchemaSuffix}`, JSON.stringify(record.schema, null, 2));
      await sink.text(
        `${directory}/schemas/.${record.name}${FsLayout.CollectionMarkerSuffix}`,
        ExportMarker.text(record.id, record.created_at)
      );
      const entryIds = plan.selection.collections.find((item) => item.name === record.name)?.entryIds;
      let entries = 0;
      for await (const entry of TransferPackageExporter.entries(store, plan, record.name, entryIds)) {
        await sink.text(ExportEntryFile.path(scope, record.name, entry.id), ExportEntryFile.text(entry));
        for (const token of MediaRefs.extract(entry.data)) referenced.add(token);
        entries++;
      }
      collections.push({ name: record.name, ...(entryIds ? { entry_ids: [...entryIds] } : {}), entries });
    }

    const carried =
      media === MediaModes.Referenced
        ? await new TransferPackageMedia(store, sink, blobStorage).write(referenced)
        : { assets: 0, folders: 0, missing: [] };

    const manifest: TransferPackageManifest = {
      package_version: TransferPackageFormat.Version,
      silo_version: SiloVersion,
      instance_id: (await store.meta()).instance_id,
      created_at: createdAt.toISOString(),
      scope: { project: scope.project, env: scope.env },
      media,
      collections,
      media_assets: carried.assets,
      media_folders: carried.folders,
      missing_media: carried.missing,
    };
    await sink.text(TransferPackageFormat.Manifest, JSON.stringify(manifest, null, 2));
    return manifest;
  }

  /** The named entries in id order, or the whole collection page by page. */
  private static async *entries(
    store: Storage,
    plan: TransferPackagePlan,
    collection: string,
    entryIds: readonly string[] | undefined
  ): AsyncGenerator<Entry> {
    const scope = plan.selection.scope;
    if (entryIds) {
      for (const id of [...entryIds].sort()) yield await store.get(scope, collection, id);
      return;
    }
    for (let offset = 0; ; offset += TransferPackageExporter.PageSize) {
      const { items } = await store.list(scope, collection, {
        sort: [{ path: "$.id", desc: false }],
        limit: TransferPackageExporter.PageSize,
        offset,
      });
      if (items.length === 0) return;
      yield* items;
    }
  }

  private static async exists(
    store: Storage,
    selection: TransferPackageSelection,
    collection: string,
    id: string
  ): Promise<boolean> {
    try {
      await store.get(selection.scope, collection, id);
      return true;
    } catch (caught) {
      if (caught instanceof NotFoundError) return false;
      throw caught;
    }
  }
}
