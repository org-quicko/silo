import type { AuditActor } from "../../audit/audit-actor";
import type { Entry } from "../../domain/entry";
import { EntryUtils } from "../../domain/entry-utils";
import type { Scope } from "../../domain/scope";
import { MediaRefs } from "../../media/media-refs";
import { TrashContentsUtils, type TrashContents } from "../../trash/trash-contents";
import type { TrashKind } from "../../trash/trash-kind";
import { TrashItemUtils, type TrashedAsset } from "../../trash/trash-item";
import type { TrashOrigin } from "../../trash/trash-origin";
import type { TrashReceipt } from "../../trash/trash-receipt";
import type { ServiceContext } from "../support/service-context";
import { TrashStore } from "./trash-store";

/** The container ids a parked entry is addressed by. */
export interface ParkedEntryIds {
  project_id: string;
  env_id: string;
  collection_id: string;
}

/** What a caller hands the parker: the subject, where it was, and who asked. */
export interface ParkRequest {
  kind: TrashKind;
  subjectId: string;
  subjectName: string;
  origin: TrashOrigin;
  actor: AuditActor;
  /** Null when retention is off. */
  expiresAt: string | null;
}

/**
 * Writes `_trash_items` documents and the receipt that stands for them (D91).
 *
 * The receipt opens in `parking`, so a crash mid-copy leaves a marker the
 * resumer can find — the staging D23 and D49 already use.
 */
export class TrashParker {
  private readonly context: ServiceContext;
  private readonly store: TrashStore;

  constructor(context: ServiceContext, store: TrashStore) {
    this.context = context;
    this.store = store;
  }

  /** Opens a receipt in `parking` and hands back its id. */
  async begin(request: ParkRequest): Promise<string> {
    const id = TrashStore.newId();
    const receipt: TrashReceipt = {
      kind: request.kind,
      origin: request.origin,
      subject_id: request.subjectId,
      subject_name: request.subjectName,
      deleted_at: EntryUtils.now().toISOString(),
      deleted_by: request.actor,
      expires_at: request.expiresAt,
      contents: TrashContentsUtils.empty(),
      media_refs: [],
      state: "parking",
    };
    await this.store.putReceipt(id, receipt);
    return id;
  }

  /** Marks the receipt restorable, with everything the copy learned. */
  async commit(id: string, contents: TrashContents, mediaRefs: Set<string>): Promise<void> {
    const entry = await this.store.receipt(id);
    const receipt = entry.data as TrashReceipt;
    await this.store.putReceipt(
      id,
      { ...receipt, contents, media_refs: [...mediaRefs], state: "parked" },
      entry.created_at instanceof Date ? entry.created_at : new Date(entry.created_at)
    );
  }

  /** Every entry in a collection, a page at a time so a large one never sits
   *  whole in memory. Copies only; the delete path removes them as it always
   *  did. */
  async copyEntries(
    trashId: string,
    scope: Scope,
    collection: string,
    contents: TrashContents,
    mediaRefs: Set<string>,
    ids: ParkedEntryIds
  ): Promise<void> {
    let offset = 0;
    while (true) {
      const page = await this.context.store.list(scope, collection, {
        limit: TrashStore.PageSize,
        offset,
      });
      if (page.items.length === 0) return;
      for (const entry of page.items) {
        await this.parkEntry(trashId, entry, contents, mediaRefs, ids);
      }
      offset += page.items.length;
      if (offset >= page.total) return;
    }
  }

  async parkEntry(
    trashId: string,
    entry: Entry,
    contents: TrashContents,
    mediaRefs: Set<string>,
    ids: ParkedEntryIds
  ): Promise<void> {
    for (const reference of MediaRefs.extract(entry.data)) mediaRefs.add(reference);
    await this.store.putItem({
      trash_id: trashId,
      kind: "entry",
      record: TrashItemUtils.toTrashedEntry(entry, ids),
    });
    TrashContentsUtils.add(contents, { entries: 1, bytes: TrashParker.weigh(entry.data) });
  }

  /** Parks any record that is not an entry. */
  async parkRecord(trashId: string, kind: TrashKind, record: unknown): Promise<void> {
    await this.store.putItem({ trash_id: trashId, kind, record });
  }

  async parkAsset(trashId: string, asset: TrashedAsset, contents: TrashContents): Promise<void> {
    await this.parkRecord(trashId, "media", asset);
    TrashContentsUtils.add(contents, { assets: 1, bytes: asset.size });
  }

  /** A document's cost on disk, near enough for a size column. */
  private static weigh(data: unknown): number {
    try {
      return JSON.stringify(data ?? null).length;
    } catch {
      return 0;
    }
  }
}
