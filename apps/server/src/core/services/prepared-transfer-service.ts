import { ValidationError } from "@silo/shared/validation-error";
import type { Entry } from "../domain/entry";
import { EntryUtils } from "../domain/entry-utils";
import { Scope } from "../domain/scope";
import { ArchiveTooLargeError } from "../errors/archive-too-large-error";
import { ConflictError } from "../errors/conflict-error";
import { NotFoundError } from "../errors/not-found-error";
import type { AtomicStorage } from "../ports/atomic-storage";
import type { TransferPackageSource } from "../ports/transfer-package-source";
import { Importer } from "../transfer/importer";
import { TransferPackageVerifier } from "../transfer/package/transfer-package-verifier";
import { TransferPlanner } from "../transfer/plan/transfer-planner";
import { PreparedTransferExpiry } from "../transfer/prepared/prepared-transfer-expiry";
import type { PreparedTransferPage } from "../transfer/prepared/prepared-transfer-page";
import type { PreparedTransferProgress } from "../transfer/prepared/prepared-transfer-progress";
import type { PreparedTransferRecord } from "../transfer/prepared/prepared-transfer-record";
import { PreparedTransferRegistry } from "../transfer/prepared/prepared-transfer-registry";
import type { PreparedTransferRequest } from "../transfer/prepared/prepared-transfer-request";
import type { PreparedTransferView } from "../transfer/prepared/prepared-transfer-view";
import { PreparedTransferViews } from "../transfer/prepared/prepared-transfer-views";
import type { ServiceContext } from "./support/service-context";

/**
 * Prepared transfers on the destination (D109): pull another silo's package
 * once, verify it exactly, plan it against the destination (D110), and keep
 * both for review until Apply, a cancel or the expiry. Nothing here writes to
 * storage, so nothing takes the write lock: the plan's baseline is what makes
 * a change made since the review visible to Apply.
 *
 * Every lookup is bound to the key that prepared the transfer and to the
 * destination scope; any other caller is told it does not exist.
 */
export class PreparedTransferService {
  private readonly context: ServiceContext;
  private readonly registry: PreparedTransferRegistry;

  constructor(context: ServiceContext) {
    this.context = context;
    this.registry = new PreparedTransferRegistry(() => context.stagingDirectory);
  }

  /** Everything that can be refused without the source, then a slot. */
  async begin(keyId: string, to: Scope, request: PreparedTransferRequest, sourceUrl: string): Promise<PreparedTransferRecord> {
    if (typeof (this.context.store as Partial<AtomicStorage>).commit !== "function") {
      throw new ConflictError(
        "this server's storage cannot apply a transfer as one change; use SQLite or Postgres",
        "atomic_commit_unsupported"
      );
    }
    const project = await this.context.store.findProject(to.project);
    if (!project || !(await this.context.store.findEnvironment(to.project, to.env))) {
      throw new NotFoundError(`environment "${to.key()}" not found`);
    }

    return this.registry.locked(async (store) => {
      await this.registry.assertRoom(store);
      const record = request.record(EntryUtils.newID(), keyId, to, sourceUrl);
      await store.write(record);
      this.registry.start(record.id);
      return record;
    });
  }

  /** Pulls, verifies and plans the package `begin` made room for. A failure removes the transfer. */
  async fill(
    record: PreparedTransferRecord,
    request: PreparedTransferRequest,
    source: TransferPackageSource,
    reveals: PreparedTransferPage["reveals"],
    report?: (progress: PreparedTransferProgress) => void
  ): Promise<PreparedTransferView> {
    const signal = this.registry.signal(record.id);
    const store = await this.registry.store();
    const transfer = { id: record.id, state: record.state, expires_at: record.expires_at };
    try {
      report?.({ phase: "fetch", transfer });
      const archive = await source.open(signal);
      const staged = await Importer.stage(archive, {
        stagingDirectory: store.directory(record.id),
        limits: this.context.importLimits,
      }).catch(PreparedTransferService.notAPackage);
      await store.adopt(record.id, staged);
      signal.throwIfAborted();

      report?.({ phase: "verify", transfer });
      const { summary, entries } = await TransferPackageVerifier.verify(store.packageDirectory(record.id), request.selection);
      signal.throwIfAborted();

      report?.({ phase: "plan", transfer });
      const planner = new TransferPlanner(this.context.store, {
        to: Scope.of(record.to.project, record.to.env),
        mode: record.mode,
        prefer: record.prefer,
        instanceId: summary.instance_id,
        collections: record.selection.map((item) => item.collection).sort(),
        entries,
        content: store.content(record),
      });
      await store.writePlan(record.id, planner.lines());
      return await this.registry.locked(async () => {
        signal.throwIfAborted();
        const now = new Date();
        const prepared: PreparedTransferRecord = {
          ...record,
          state: "prepared",
          package: summary,
          review: planner.review(),
          updated_at: now.toISOString(),
          expires_at: PreparedTransferExpiry.expiresAt(now),
        };
        await store.write(prepared);
        return PreparedTransferViews.of(store, prepared, { offset: 0, limit: PreparedTransferViews.DefaultLimit, reveals });
      });
    } catch (caught) {
      if (!signal.aborted) {
        await store.remove(record.id);
        throw caught;
      }
      await store.drop(record.id);
      throw new ConflictError("this transfer was cancelled", "transfer_cancelled");
    } finally {
      this.registry.finish(record.id);
    }
  }

  async read(keyId: string, to: Scope, id: string, page: PreparedTransferPage): Promise<PreparedTransferView> {
    return this.registry.locked(async (store) =>
      PreparedTransferViews.of(store, await this.registry.owned(store, keyId, to, id), page)
    );
  }

  /** One packaged entry as it will be reviewed, addressed to the destination. */
  async entry(keyId: string, to: Scope, id: string, collection: string, entryId: string): Promise<Entry> {
    const store = await this.registry.store();
    const record = await this.registry.locked(() => this.registry.owned(store, keyId, to, id));
    if (record.state !== "prepared") throw new NotFoundError(`transfer "${id}" holds no package: it is ${record.state}`);
    EntryUtils.assertSafeSegment(entryId, "entry id");
    const selected = record.selection.some((item) => item.collection === collection);
    const packaged = selected && !entryId.startsWith(".") ? await store.entry(record, collection, entryId) : null;
    if (!packaged) throw new NotFoundError(`entry "${collection}/${entryId}" is not in this transfer`);
    return { ...packaged, project: to.project, env: to.env, collection };
  }

  /** Stops a pull or drops a prepared package. An ended transfer is answered as it is. */
  async cancel(keyId: string, to: Scope, id: string): Promise<PreparedTransferView> {
    return this.registry.locked(async (store) => {
      const record = await this.registry.owned(store, keyId, to, id);
      if (record.state === "applying") throw new ConflictError("this transfer is being applied", "transfer_in_progress");
      if (record.state === "applied") throw new ConflictError("this transfer is already applied", "transfer_applied");
      if (record.state !== "preparing" && record.state !== "prepared") return PreparedTransferViews.of(store, record);

      const cancelled: PreparedTransferRecord = { ...record, state: "cancelled", updated_at: new Date().toISOString() };
      await store.write(cancelled);
      // A running pull removes its own files once it sees the abort.
      if (record.state === "prepared") await store.drop(id);
      this.registry.abort(id);
      return PreparedTransferViews.of(store, cancelled);
    });
  }

  /** A body that will not unpack was never a package: the source does not send one.
   *  A size refusal stays itself, though tar tags the abort it causes. */
  private static notAPackage(caught: any): never {
    if (caught instanceof ArchiveTooLargeError) throw caught;
    const code = typeof caught?.code === "string" ? caught.code : "";
    if (code.startsWith("TAR_") || code.startsWith("Z_")) {
      throw new ValidationError(`the source did not send a transfer package (${caught.message}); it needs silo 1.6.0 or later`);
    }
    throw caught;
  }
}
