import { MediaRef } from "@silo/shared/media-ref";
import { ValidationError } from "@silo/shared/validation-error";
import type { Entry } from "../../domain/entry";
import { EntryUtils } from "../../domain/entry-utils";
import { Scope } from "../../domain/scope";
import { NotFoundError } from "../../errors/not-found-error";
import type { MediaAsset } from "../../media/media-asset";
import { MediaCatalog } from "../../media/media-catalog";
import { MediaRefs } from "../../media/media-refs";
import type { Storage } from "../../ports/storage";
import type { TransferMediaReview } from "./transfer-media-review";
import { TransferPlanBaseline } from "./transfer-plan-baseline";
import type { TransferPlanInput } from "./transfer-plan-input";
import type { TransferPlanLine } from "./transfer-plan-line";

/**
 * The media half of a transfer's plan (D111). Reads only.
 *
 * A packaged asset is added when this server has no asset with its id and no
 * file at its key. An asset this server already holds is never changed: it is
 * `unchanged` when it is the same file with the same details, and `skipped`,
 * with the reason, when it is not. Folders are matched by path; a missing one
 * is added under the package's id when that id is free. Nothing is deleted.
 */
export class TransferMediaPlanner {
  private readonly store: Storage;
  private readonly input: TransferPlanInput;
  private readonly planned: TransferPlanLine[] = [];
  /** Asset id to the `seq` a reference to it resolves at, or null when it will not resolve. */
  private readonly destination = new Map<string, number | null>();
  private readonly carried = new Set<string>();
  private readonly added = new Set<string>();
  private readonly unresolved = new Set<string>();

  constructor(store: Storage, input: TransferPlanInput) {
    this.store = store;
    this.input = input;
  }

  async plan(): Promise<void> {
    for (const row of await this.input.content.assets()) this.planned.push(await this.asset(row));
    const folders = (await this.input.content.folders()).sort((left, right) =>
      MediaCatalog.folderOf(left) < MediaCatalog.folderOf(right) ? -1 : 1
    );
    for (const row of folders) this.planned.push(await this.folder(row));
  }

  lines(): readonly TransferPlanLine[] {
    return this.planned;
  }

  /**
   * The references in `data` that will not resolve here once the plan lands.
   * A pre-D23 `blob:` reference names a key rather than an asset and is not
   * judged, as the entry API does not judge it.
   */
  async unresolvedIn(data: unknown): Promise<string[]> {
    const missing: string[] = [];
    for (const token of MediaRefs.extract(data)) {
      if (token.startsWith(MediaRef.BlobTokenPrefix) || this.added.has(token)) continue;
      if ((await this.resolvedAt(token)) !== null) continue;
      missing.push(token);
      this.unresolved.add(token);
    }
    return missing;
  }

  review(): TransferMediaReview {
    const count = (collection: string, action: TransferPlanLine["action"]) =>
      this.planned.filter((line) => line.collection === collection && line.action === action).length;
    return {
      added: count(MediaCatalog.Collection, "added"),
      unchanged: count(MediaCatalog.Collection, "unchanged"),
      skipped: count(MediaCatalog.Collection, "skipped"),
      folders_added: count(MediaCatalog.FoldersCollection, "added"),
      unresolved: [...this.unresolved].sort(),
      resolved: [...this.destination]
        .filter((pair): pair is [string, number] => pair[1] !== null && !this.carried.has(pair[0]))
        .map(([id, seq]) => ({ id, seq }))
        .sort((left, right) => (left.id < right.id ? -1 : 1)),
    };
  }

  private async asset(row: Entry): Promise<TransferPlanLine> {
    const incoming = MediaCatalog.toAsset(row);
    const local = await this.existing(MediaCatalog.Collection, row.id);
    this.carried.add(row.id);
    const line: TransferPlanLine = {
      collection: MediaCatalog.Collection,
      id: row.id,
      action: "added",
      name: incoming.filename,
      rev: row.rev,
      updated_at: new Date(row.updated_at).toISOString(),
      ...(local ? { destination: TransferPlanBaseline.of(local) } : {}),
    };
    if (!local) {
      this.destination.set(row.id, null);
      if (await this.input.blobs.exists(incoming.blob_key)) {
        return { ...line, action: "skipped", reason: `this server already has a file at "${incoming.blob_key}"` };
      }
      this.added.add(row.id);
      return line;
    }
    const current = MediaCatalog.toAsset(local);
    this.destination.set(row.id, current.state === "active" ? local.seq : null);
    const reason = TransferMediaPlanner.difference(current, incoming);
    return reason ? { ...line, action: "skipped", reason } : { ...line, action: "unchanged" };
  }

  private async folder(row: Entry): Promise<TransferPlanLine> {
    const path = MediaCatalog.folderOf(row);
    const line = { collection: MediaCatalog.FoldersCollection, name: path, rev: row.rev, updated_at: new Date(row.updated_at).toISOString() };
    const { items } = await this.store.list(Scope.System, MediaCatalog.FoldersCollection, {
      filter: { op: "eq", path: "$.data.path", value: path },
      limit: 1,
      offset: 0,
    });
    const existing = items[0];
    if (existing) return { ...line, id: existing.id, action: "unchanged", destination: TransferPlanBaseline.of(existing) };
    const taken = await this.existing(MediaCatalog.FoldersCollection, row.id);
    return { ...line, id: taken ? EntryUtils.newID() : row.id, action: "added" };
  }

  /** Why this server keeps its own asset rather than the package's, or undefined when they are the same. */
  private static difference(current: MediaAsset, incoming: MediaAsset): string | undefined {
    if (current.state !== "active") return "this server is deleting its asset with this id";
    if (current.hash !== incoming.hash || current.size !== incoming.size) {
      return "this server has other bytes under this id, and keeps them";
    }
    const details = (asset: MediaAsset) =>
      JSON.stringify([asset.filename, asset.folder, asset.content_type, [...asset.tags].sort()]);
    if (details(current) !== details(incoming)) {
      return "this server's asset with this id has another filename, folder or tags, and keeps them";
    }
    return undefined;
  }

  private async resolvedAt(id: string): Promise<number | null> {
    if (!this.destination.has(id)) {
      const row = await this.existing(MediaCatalog.Collection, id);
      this.destination.set(id, row && MediaCatalog.toAsset(row).state === "active" ? row.seq : null);
    }
    return this.destination.get(id)!;
  }

  private async existing(collection: string, id: string): Promise<Entry | null> {
    try {
      return await this.store.get(Scope.System, collection, id);
    } catch (caught) {
      if (caught instanceof NotFoundError || ValidationError.is(caught)) return null;
      throw caught;
    }
  }
}
