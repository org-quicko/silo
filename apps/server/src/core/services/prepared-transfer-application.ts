import type { Scope } from "../domain/scope";
import { ConflictError } from "../errors/conflict-error";
import { TransferUnsettledError } from "../errors/transfer-unsettled-error";
import { TransferApplier } from "../transfer/apply/transfer-applier";
import type { PreparedTransferProgress } from "../transfer/prepared/prepared-transfer-progress";
import type { PreparedTransferRecord } from "../transfer/prepared/prepared-transfer-record";
import type { PreparedTransferRegistry } from "../transfer/prepared/prepared-transfer-registry";
import type { PreparedTransferStore } from "../transfer/prepared/prepared-transfer-store";
import type { ServiceContext } from "./support/service-context";

/**
 * Apply, and the recovery of an apply a stopped process left (D111).
 *
 * A transfer moves to `applying` under the registry's lock, so a second apply
 * or a cancel meets that state, and the work runs under the write lock, as
 * every write does. The outcome is recorded under the registry's lock again:
 * `applied` keeps the record and drops the package; a plan that no longer
 * holds is `stale`; any other failure returns the transfer to `prepared`,
 * with the reason, to be applied again.
 */
export class PreparedTransferApplication {
  private readonly context: ServiceContext;
  private readonly registry: PreparedTransferRegistry;

  constructor(context: ServiceContext, registry: PreparedTransferRegistry) {
    this.context = context;
    this.registry = registry;
  }

  /** Applies the transfer once; applying an applied one answers it as it is. */
  async apply(
    keyId: string,
    to: Scope,
    id: string,
    report?: (progress: PreparedTransferProgress) => void
  ): Promise<PreparedTransferRecord> {
    const files = await this.registry.store();
    const begun = await this.registry.locked(async () => {
      const record = await this.registry.owned(files, keyId, to, id);
      if (record.state === "applied") return null;
      if (record.state === "applying" && this.registry.isRunning(id)) {
        throw new ConflictError("this transfer is being applied", "transfer_in_progress");
      }
      if (record.state !== "applying") PreparedTransferApplication.assertReady(record);
      const applying: PreparedTransferRecord = { ...record, state: "applying", updated_at: new Date().toISOString() };
      await files.write(applying);
      this.registry.start(id);
      // An `applying` record nothing runs is an apply whose outcome was never settled.
      return { record: applying, unsettled: record.state === "applying" };
    });
    if (!begun) return (await files.read(id))!;

    const applier = new TransferApplier(this.context, files);
    const transfer = { id, state: begun.record.state, expires_at: begun.record.expires_at };
    try {
      const outcome = await this.context.withWriteLock(async () => {
        const settled = begun.unsettled ? await applier.settle(begun.record) : begun.record;
        if (settled.state === "applied") return settled;
        return applier.apply({ ...settled, state: "applying" }, (phase) => report?.({ phase, transfer }));
      });
      this.context.schemaRegistry.invalidate();
      return await this.registry.locked(async () => {
        await files.write(outcome);
        await files.drop(id);
        return outcome;
      });
    } catch (caught) {
      await this.registry.locked(() => PreparedTransferApplication.failed(files, id, caught));
      throw caught instanceof TransferUnsettledError ? caught.cause : caught;
    } finally {
      this.registry.finish(id);
    }
  }

  /** Settles every `applying` transfer a stopped process left. Run at start, before requests. */
  async resumeInterrupted(): Promise<{ applied: number; restored: number; pending: number }> {
    const files = await this.registry.store();
    const applier = new TransferApplier(this.context, files);
    const outcome = { applied: 0, restored: 0, pending: 0 };
    for (const record of await files.list()) {
      if (record.state !== "applying" || this.registry.isRunning(record.id)) continue;
      try {
        const settled = await this.context.withWriteLock(() => applier.settle(record));
        await this.registry.locked(async () => {
          await files.write(settled);
          if (settled.state === "applied") await files.drop(record.id);
        });
        outcome[settled.state === "applied" ? "applied" : "restored"]++;
      } catch {
        outcome.pending++;
      }
    }
    if (outcome.applied > 0) this.context.schemaRegistry.invalidate();
    return outcome;
  }

  private static assertReady(record: PreparedTransferRecord): void {
    if (record.state === "prepared") return;
    if (record.state === "preparing") throw new ConflictError("this transfer is still being prepared", "transfer_in_progress");
    if (record.state === "cancelled") throw new ConflictError("this transfer was cancelled", "transfer_cancelled");
    if (record.state === "expired") throw new ConflictError("this transfer expired; prepare it again", "transfer_expired");
    throw new ConflictError("this server changed since the transfer was planned; prepare it again", "stale_preview");
  }

  /** Records a failed apply, from the record as the applier left it on disk. */
  private static async failed(files: PreparedTransferStore, id: string, caught: unknown): Promise<void> {
    const current = await files.read(id);
    if (!current) return;
    const updated_at = new Date().toISOString();
    if (caught instanceof TransferUnsettledError) {
      // Still `applying`, with its keys, for a later apply or the next start to settle.
      await files.write({ ...current, updated_at, last_error: caught.message });
      return;
    }
    const { blob_intents: _intents, ...rest } = current;
    if (caught instanceof ConflictError && caught.code === "stale_preview") {
      await files.write({ ...rest, state: "stale", updated_at, last_error: caught.message });
      await files.drop(id);
      return;
    }
    await files.write({ ...rest, state: "prepared", updated_at, last_error: caught instanceof Error ? caught.message : String(caught) });
  }
}
