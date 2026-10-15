import fs from "fs/promises";
import os from "os";
import path from "path";
import type { Scope } from "../../domain/scope";
import { NotFoundError } from "../../errors/not-found-error";
import { TooManyTransfersError } from "../../errors/too-many-transfers-error";
import { AsyncMutex } from "../../services/support/async-mutex";
import { PreparedTransferExpiry } from "./prepared-transfer-expiry";
import type { PreparedTransferRecord } from "./prepared-transfer-record";
import { PreparedTransferStates } from "./prepared-transfer-state";
import { PreparedTransferStore } from "./prepared-transfer-store";

/**
 * Who may see which prepared transfer, and how many there are (D109).
 *
 * One lock covers every state change, so the slot count and a cancel racing a
 * finishing pull each have one answer. The pulls this process runs are known
 * by id, which is how a `preparing` record left by a stopped process is told
 * apart from a live one: one process owns a data directory (D25, D94).
 */
export class PreparedTransferRegistry {
  private readonly lock = new AsyncMutex();
  private readonly running = new Map<string, AbortController>();
  private readonly staging: () => string | undefined;
  private files: Promise<PreparedTransferStore> | undefined;

  /** `staging` is read when first needed, because the service is built before it is set. */
  constructor(staging: () => string | undefined) {
    this.staging = staging;
  }

  /** Beside the instance's staging directory, or in a temporary one when it has none. */
  store(): Promise<PreparedTransferStore> {
    this.files ??= (async () => {
      const staging = this.staging();
      const root = staging ? path.join(staging, "prepared") : await fs.mkdtemp(path.join(os.tmpdir(), "silo-prepared-"));
      return new PreparedTransferStore(root);
    })();
    return this.files;
  }

  async locked<T>(work: (store: PreparedTransferStore) => Promise<T>): Promise<T> {
    const store = await this.store();
    const release = await this.lock.acquire();
    try {
      return await work(store);
    } finally {
      release();
    }
  }

  /** Refuses when every slot is taken. Call under the lock. */
  async assertRoom(store: PreparedTransferStore): Promise<void> {
    let open = 0;
    for (const record of await store.list()) {
      const current = await this.refresh(store, record);
      if (current && PreparedTransferStates.Open.has(current.state)) open++;
    }
    if (open >= PreparedTransferExpiry.MaxOpen) throw new TooManyTransfersError(open);
  }

  /** The transfer, as it stands now, when `keyId` prepared it for `to`. Call under the lock. */
  async owned(store: PreparedTransferStore, keyId: string, to: Scope, id: string): Promise<PreparedTransferRecord> {
    const record = await this.refresh(store, await store.read(id));
    if (!record || record.key_id !== keyId || record.to.project !== to.project || record.to.env !== to.env) {
      throw new NotFoundError(`transfer "${id}" not found`);
    }
    return record;
  }

  /** Marks a pull, or an apply (D111), as running in this process. */
  start(id: string): void {
    this.running.set(id, new AbortController());
  }

  isRunning(id: string): boolean {
    return this.running.has(id);
  }

  /** What a running pull watches to learn it was cancelled. */
  signal(id: string): AbortSignal {
    const controller = this.running.get(id);
    if (!controller) throw new Error(`transfer "${id}" has no running pull`);
    return controller.signal;
  }

  finish(id: string): void {
    this.running.delete(id);
  }

  /** Stops a running pull; nothing happens when there is none. */
  abort(id: string): void {
    this.running.get(id)?.abort();
  }

  private refresh(store: PreparedTransferStore, record: PreparedTransferRecord | null): Promise<PreparedTransferRecord | null> {
    return PreparedTransferExpiry.refresh(store, record, (id) => this.isRunning(id));
  }
}
