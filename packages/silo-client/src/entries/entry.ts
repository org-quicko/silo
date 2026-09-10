import type { RequestOptions } from "../request-options.js";
import { ApiPath } from "../transport/api-path.js";
import { EntryMapper } from "./entry-mapper.js";
import type { EntryPayload } from "./entry-payload.js";
import { ResolvedEntry } from "./resolved-entry.js";

/**
 * An editable entry, from a raw read: `posts.edit(id)`, a create, a
 * replace, or any read on a client constructed with `variables: "raw"`.
 * `fields` is mutable again here, undoing `ResolvedEntry`'s narrowing.
 */
export class Entry<Fields> extends ResolvedEntry<Fields> {
  declare rev: number;
  declare createdAt: Date;
  declare updatedAt: Date;
  declare fields: Fields;

  private saving = false;

  /**
   * Sends `PUT` with the rev this instance holds, adopts the rev and
   * timestamps the response answers, and mutates in place. A second
   * overlapping call on the same instance is refused locally — it would
   * send a rev already known to be stale.
   */
  async save(options: RequestOptions = {}): Promise<this> {
    if (this.saving) {
      throw new Error(`cannot save entry "${this.id}": a previous save() on this instance has not finished yet`);
    }
    this.saving = true;
    try {
      const payload = await this.context.transport.json<EntryPayload>({
        method: "PUT",
        path: ApiPath.entry(this.context.project, this.context.environment, this.context.collection, this.id),
        query: { rev: this.rev, variables: "raw" },
        body: this.fields,
        ...options,
      });
      this.adopt(payload);
      return this;
    } finally {
      this.saving = false;
    }
  }

  /** Re-reads this entry raw, and replaces `fields`, `rev` and the
   * timestamps in place — what a `ConflictError` from `save()` calls for. */
  async refresh(options: RequestOptions = {}): Promise<this> {
    const payload = await this.context.transport.json<EntryPayload>({
      method: "GET",
      path: ApiPath.entry(this.context.project, this.context.environment, this.context.collection, this.id),
      query: { variables: "raw" },
      ...options,
    });
    this.adopt(payload);
    return this;
  }

  private adopt(payload: EntryPayload): void {
    this.rev = Number(payload.rev);
    this.createdAt = new Date(payload.created_at);
    this.updatedAt = new Date(payload.updated_at);
    this.fields = EntryMapper.fieldsOf<Fields>(payload);
  }
}
