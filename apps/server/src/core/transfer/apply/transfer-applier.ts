import { Scope } from "../../domain/scope";
import { CommitConflictError } from "../../errors/commit-conflict-error";
import { ConflictError } from "../../errors/conflict-error";
import { TransferUnsettledError } from "../../errors/transfer-unsettled-error";
import { MediaCatalog } from "../../media/media-catalog";
import type { AtomicStorage } from "../../ports/atomic-storage";
import type { ServiceContext } from "../../services/support/service-context";
import { TransferDestination } from "../plan/transfer-destination";
import type { PreparedTransferRecord } from "../prepared/prepared-transfer-record";
import type { PreparedTransferStore } from "../prepared/prepared-transfer-store";
import { TransferBlobs } from "./transfer-blobs";
import { TransferChangeSet } from "./transfer-change-set";
import type { TransferChanges } from "./transfer-changes";
import { TransferLedger } from "./transfer-ledger";

/**
 * Applies a planned transfer as one commit (D111), and settles one whose
 * outcome was not seen.
 *
 * Call both **under the write lock**. It is what makes the two checks a commit
 * cannot state hold until the commit: no folder has appeared at a path the
 * plan adds, and no file at a key it writes. The keys are saved in the record
 * before the first file is written, so whatever stops the apply, a failure or
 * the process, leaves behind what is needed to take them back.
 */
export class TransferApplier {
  static readonly Interrupted = "interrupted: the server stopped while this transfer was being applied, and nothing was written";

  private readonly context: ServiceContext;
  private readonly files: PreparedTransferStore;

  constructor(context: ServiceContext, files: PreparedTransferStore) {
    this.context = context;
    this.files = files;
  }

  /** The applied record, or a `stale_preview` conflict when anything the plan read has moved. */
  async apply(record: PreparedTransferRecord, report?: (phase: "media" | "commit") => void): Promise<PreparedTransferRecord> {
    const store = this.context.store as AtomicStorage;
    await this.assertSameDestination(record);
    const appliedAt = new Date();
    const built = await TransferChangeSet.build(store, record, this.files.lines(record.id), this.files.package(record), appliedAt);
    await this.assertStillFree(built);

    const applying: PreparedTransferRecord = { ...record, blob_intents: built.blobs.map((blob) => blob.key) };
    await this.files.write(applying);
    try {
      report?.("media");
      await TransferBlobs.put(this.context.blobStorage, built.blobs);
      report?.("commit");
      await store.commit(built.changes);
    } catch (caught) {
      if (!(caught instanceof CommitConflictError)) return this.settle(applying, caught);
      await this.release(applying, caught);
      throw TransferApplier.stale(caught.message);
    }
    return TransferApplier.applied(applying, appliedAt.toISOString());
  }

  /**
   * What became of an apply whose end was not seen. The ledger row says the
   * commit landed. Without it, the files the apply wrote are taken back and
   * the transfer is `prepared` again; with a `cause`, that is rethrown instead.
   */
  async settle(record: PreparedTransferRecord, cause?: unknown): Promise<PreparedTransferRecord> {
    let ledger;
    try {
      ledger = await TransferLedger.find(this.context.store, record.id);
    } catch (failed) {
      throw new TransferUnsettledError(cause ?? failed);
    }
    if (ledger) return TransferApplier.applied(record, String(ledger.data.applied_at));
    await this.release(record, cause);
    if (cause !== undefined) throw cause;
    const { blob_intents: _intents, ...rest } = record;
    return { ...rest, state: "prepared", updated_at: new Date().toISOString(), last_error: TransferApplier.Interrupted };
  }

  /** Absence preconditions hold in an environment recreated under the same
   *  name, and the schema writes would recreate a deleted one, so the ids are
   *  checked here. */
  private async assertSameDestination(record: PreparedTransferRecord): Promise<void> {
    const to = Scope.of(record.to.project, record.to.env);
    const current = await TransferDestination.ids(this.context.store, to);
    const planned = record.review?.destination;
    if (!current || current.project_id !== planned?.project_id || current.env_id !== planned?.env_id) {
      throw TransferApplier.stale(`environment "${to.key()}" was deleted or replaced`);
    }
  }

  private async assertStillFree(built: TransferChanges): Promise<void> {
    for (const path of built.folders) {
      const { total } = await this.context.store.list(Scope.System, MediaCatalog.FoldersCollection, {
        filter: { op: "eq", path: "$.data.path", value: path },
        limit: 1,
        offset: 0,
      });
      if (total > 0) throw TransferApplier.stale(`a folder now exists at "${path}"`);
    }
    const taken = await TransferBlobs.taken(this.context.blobStorage, built.blobs.map((blob) => blob.key));
    if (taken) throw TransferApplier.stale(`a file now exists at "${taken}"`);
  }

  private async release(record: PreparedTransferRecord, cause: unknown): Promise<void> {
    try {
      await TransferBlobs.release(this.context.store, this.context.blobStorage, record.blob_intents ?? []);
    } catch (failed) {
      throw new TransferUnsettledError(cause ?? failed);
    }
  }

  private static applied(record: PreparedTransferRecord, appliedAt: string): PreparedTransferRecord {
    const { blob_intents: _intents, last_error: _error, ...rest } = record;
    return { ...rest, state: "applied", applied_at: appliedAt, updated_at: new Date().toISOString() };
  }

  private static stale(detail: string): ConflictError {
    return new ConflictError(`this server changed since the transfer was planned; prepare it again (${detail})`, "stale_preview");
  }
}
