import type { Entry } from "../../domain/entry";
import { Scope } from "../../domain/scope";
import { SystemCollections } from "../../domain/system-collections";
import { NotFoundError } from "../../errors/not-found-error";
import type { CommitPrecondition } from "../../ports/commit-precondition";
import type { Storage } from "../../ports/storage";
import type { PreparedTransferRecord } from "../prepared/prepared-transfer-record";

/**
 * The `_transfers` row an apply writes inside its own commit (D111): the
 * receipt. The commit expects it absent, so a transfer lands at most once, and
 * after a restart its presence is what says the commit landed. Instance-local,
 * like the audit log, and kept without limit.
 */
export class TransferLedger {
  static readonly Collection = SystemCollections.Transfers;

  static precondition(id: string): CommitPrecondition {
    return { kind: "entry", scope: Scope.System, collection: TransferLedger.Collection, id, seq: null };
  }

  static row(record: PreparedTransferRecord, appliedAt: Date): Entry {
    const review = record.review!;
    return {
      id: record.id,
      project: Scope.System.project,
      env: Scope.System.env,
      collection: TransferLedger.Collection,
      rev: 1,
      seq: 0,
      created_at: appliedAt,
      updated_at: appliedAt,
      data: {
        source_url: record.source_url,
        from: record.from,
        to: record.to,
        key_id: record.key_id,
        selection: record.selection,
        mode: record.mode,
        ...(record.prefer ? { prefer: record.prefer } : {}),
        media: record.media,
        prepared_at: record.created_at,
        applied_at: appliedAt.toISOString(),
        added: review.added,
        updated: review.updated,
        deleted: review.deleted,
        skipped: review.skipped,
        rejected: review.rejected,
        media_added: review.media.added,
        folders_added: review.media.folders_added,
        unresolved_media: review.media.unresolved.length,
      },
    };
  }

  /** The row for transfer `id`, or null when its commit never landed. */
  static async find(store: Storage, id: string): Promise<Entry | null> {
    try {
      return await store.get(Scope.System, TransferLedger.Collection, id);
    } catch (caught) {
      if (caught instanceof NotFoundError) return null;
      throw caught;
    }
  }
}
