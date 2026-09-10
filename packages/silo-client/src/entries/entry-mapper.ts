import type { EntryPayload } from "./entry-payload.js";

/**
 * The one place an entry's envelope (`id`, `rev`, `created_at`, `updated_at`)
 * is split from its content. Never touches a field name either direction
 *: whatever is left after the four known keys are removed is handed
 * back exactly as it arrived.
 */
export class EntryMapper {
  static fieldsOf<Fields>(payload: EntryPayload): Fields {
    const { id: _id, rev: _rev, created_at: _createdAt, updated_at: _updatedAt, ...fields } = payload;
    return fields as Fields;
  }

  /** The flat wire shape `toJSON()` answers: the envelope rebuilt around
   * whatever `fields` currently holds. */
  static toPayload<Fields>(id: string, rev: number, fields: Fields, createdAt: Date, updatedAt: Date): EntryPayload {
    return {
      id,
      rev,
      ...(fields as Record<string, unknown>),
      created_at: createdAt.toISOString(),
      updated_at: updatedAt.toISOString(),
    };
  }
}
