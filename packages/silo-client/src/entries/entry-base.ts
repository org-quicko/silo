import type { RequestOptions } from "../request-options.js";
import { ApiPath } from "../transport/api-path.js";
import type { Transport } from "../transport/transport.js";
import { EntryMapper } from "./entry-mapper.js";
import type { EntryPayload } from "./entry-payload.js";

/** What an entry needs to address itself: the transport, and the scope and
 * collection its id lives in. */
export interface EntryContext {
  readonly transport: Transport;
  readonly project: string;
  readonly environment: string;
  readonly collection: string;
}

/**
 * What every entry has regardless of whether it is editable: identity,
 * timestamps, its fields, a plain snapshot, and `delete()` — which needs
 * only an id and a rev, not the content. `rev`/`createdAt`/`updatedAt`/
 * `fields` are declared `readonly` here; {@link Entry} is the one subclass
 * that redeclares them mutable, since it is the one subclass with something
 * that legitimately changes them.
 */
export abstract class EntryBase<Fields> {
  readonly id: string;
  readonly rev: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly fields: Fields;

  constructor(
    protected readonly context: EntryContext,
    payload: EntryPayload,
  ) {
    this.id = String(payload.id);
    this.rev = Number(payload.rev);
    this.createdAt = new Date(payload.created_at);
    this.updatedAt = new Date(payload.updated_at);
    this.fields = EntryMapper.fieldsOf<Fields>(payload);
  }

  /** The flat wire shape, for logging or React state. */
  toJSON(): EntryPayload {
    return EntryMapper.toPayload(this.id, this.rev, this.fields, this.createdAt, this.updatedAt);
  }

  async delete(options: RequestOptions = {}): Promise<void> {
    await this.context.transport.empty({
      method: "DELETE",
      path: ApiPath.entry(this.context.project, this.context.environment, this.context.collection, this.id),
      query: { rev: this.rev },
      ...options,
    });
  }
}
