import type { Entry } from "../../domain/entry";
import { Scope } from "../../domain/scope";
import { MediaCatalog } from "../../media/media-catalog";
import { MediaDisposition } from "../../media/media-disposition";
import { MediaRefs } from "../../media/media-refs";
import type { CommitPrecondition } from "../../ports/commit-precondition";
import type { CommitWrite } from "../../ports/commit-write";
import type { DerivedIndex } from "../../ports/derived-index";
import type { Storage } from "../../ports/storage";
import { SearchText } from "../../search/search-text";
import type { TransferPackageContent } from "../plan/transfer-package-content";
import type { TransferPlanLine } from "../plan/transfer-plan-line";
import type { PreparedTransferRecord } from "../prepared/prepared-transfer-record";
import type { TransferChanges } from "./transfer-changes";
import { TransferLedger } from "./transfer-ledger";

/**
 * Turns a transfer's plan into the one commit Apply makes (D111): every
 * baseline the plan recorded becomes a precondition, and every line that
 * writes becomes a write, followed by the ledger row.
 *
 * Nothing is decided here. The plan decided, and the package is the one it
 * was decided on, so this only reads both. The search text is extracted
 * against the effective schema, as validation was.
 */
export class TransferChangeSet {
  private static readonly Untracked: DerivedIndex = { usages: [], search: null };

  static async build(
    store: Storage,
    record: PreparedTransferRecord,
    lines: AsyncIterable<TransferPlanLine>,
    content: TransferPackageContent,
    appliedAt: Date
  ): Promise<TransferChanges> {
    const to = Scope.of(record.to.project, record.to.env);
    const review = record.review!;
    const planned = new Map<string, TransferPlanLine[]>();
    for await (const line of lines) {
      if (!planned.has(line.collection)) planned.set(line.collection, []);
      planned.get(line.collection)!.push(line);
    }
    const preconditions: CommitPrecondition[] = [];
    const writes: CommitWrite[] = [];
    const built: TransferChanges = { changes: { preconditions, writes }, blobs: [], folders: [] };

    // Media first, so a reference lands in the same commit as the asset it names.
    const assets = new Map((await content.assets()).map((row) => [row.id, row]));
    for (const line of planned.get(MediaCatalog.Collection) ?? []) {
      preconditions.push(TransferChangeSet.at(Scope.System, line));
      if (line.action !== "added") continue;
      const row = assets.get(line.id)!;
      const asset = MediaCatalog.toAsset(row);
      writes.push(TransferChangeSet.put(TransferChangeSet.envelope(row, Scope.System, MediaCatalog.Collection, asset), TransferChangeSet.Untracked));
      built.blobs.push({
        key: asset.blob_key,
        file: content.mediaFile(asset.blob_key),
        options: { contentType: asset.content_type, contentDisposition: MediaDisposition.header(asset.content_type, asset.filename) },
      });
    }
    for (const line of planned.get(MediaCatalog.FoldersCollection) ?? []) {
      preconditions.push(TransferChangeSet.at(Scope.System, line));
      if (line.action !== "added") continue;
      const folder = { id: line.id, rev: 1, created_at: appliedAt, updated_at: appliedAt, data: { path: line.name } } as Entry;
      writes.push(TransferChangeSet.put(TransferChangeSet.envelope(folder, Scope.System, MediaCatalog.FoldersCollection), TransferChangeSet.Untracked));
      built.folders.push(line.name!);
    }
    for (const { id, seq } of review.media.resolved) {
      preconditions.push({ kind: "entry", scope: Scope.System, collection: MediaCatalog.Collection, id, seq });
    }

    for (const collection of review.collections) {
      const name = collection.collection;
      const lines = planned.get(name) ?? [];
      const { record: stamp, rows } = collection.baseline;
      preconditions.push({ kind: "collection", scope: to, collection: name, record: stamp && { id: stamp.id, updatedAt: stamp.updated_at } });
      if (rows) {
        const listed = rows === "listed" ? lines.filter((line) => line.destination) : [];
        preconditions.push({ kind: "entries", scope: to, collection: name, rows: listed.map((line) => ({ id: line.id, seq: line.destination!.seq })) });
      }
      if (rows !== "listed") for (const line of lines) preconditions.push(TransferChangeSet.at(to, line));

      const incoming = collection.schema === "unchanged" ? undefined : await content.schema(name);
      if (incoming !== undefined) writes.push({ kind: "schema", scope: to, collection: name, schema: incoming });
      const schema = incoming ?? (await store.getSchema(to, name));
      for (const line of lines) {
        if (line.action === "added" || line.action === "updated") {
          const entry = TransferChangeSet.envelope((await content.entry(name, line.id))!, to, name);
          writes.push(TransferChangeSet.put(entry, { usages: MediaRefs.extract(entry.data), search: SearchText.extract(entry.data, schema) }));
        } else if (record.mode === "replace" && line.destination) {
          // Replace keeps only what it writes: a row the package does not carry, or one it carries and the schema refused.
          writes.push({ kind: "delete", scope: to, collection: name, id: line.id });
        }
      }
    }

    preconditions.push(TransferLedger.precondition(record.id));
    writes.push(TransferChangeSet.put(TransferLedger.row(record, appliedAt), TransferChangeSet.Untracked));
    return built;
  }

  /** The line's row as the plan saw it: at its `seq`, or absent. */
  private static at(scope: Scope, line: TransferPlanLine): CommitPrecondition {
    return { kind: "entry", scope, collection: line.collection, id: line.id, seq: line.destination?.seq ?? null };
  }

  private static put(entry: Entry, derived: DerivedIndex): CommitWrite {
    return { kind: "put", entry, derived };
  }

  /** A package row addressed here, its dates parsed. `data` replaces the row's when given. */
  private static envelope(row: Entry, scope: Scope, collection: string, data?: unknown): Entry {
    return {
      id: row.id,
      project: scope.project,
      env: scope.env,
      collection,
      rev: row.rev,
      seq: 0,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
      data: data ?? row.data,
    };
  }
}
