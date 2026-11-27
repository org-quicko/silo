import type { Entry } from './types/entry'

/**
 * Decodes wire entries from the API into the admin UI's `Entry` shape.
 *
 * Every entry, search, and transfer-entry endpoint answers flat objects from
 * `EntryUtils.toApiResponse` (`{ id, rev, created_at, updated_at, ... }`), so
 * `fromApiEntry` never guesses envelopes from a `data` property — a user field
 * legitimately named `data` must survive intact. Use `fromEnvelope` only when
 * an explicit `{ ..., data }` envelope is expected.
 */
export class EntryMapper {
  static fromApiEntry(item: any, fallbackCollection = ''): Entry {
    if (!item || typeof item !== 'object') return item
    // `collection` is deliberately not destructured off: the flat entry
    // response has never carried one, so stripping it only ever swallowed a
    // user field legitimately named `collection` — reserved names are refused
    // at write time now, and that is not one of them (D62).
    const { id, created_at, updated_at, rev, seq, ...data } = item
    return {
      id: id || '',
      collection: fallbackCollection,
      rev: rev ?? 1,
      seq: seq ?? 0,
      created_at: created_at || '',
      updated_at: updated_at || '',
      data,
    }
  }

  /** Normalizes an explicit `{ id, collection, rev, seq, created_at, updated_at, data }` envelope. */
  static fromEnvelope(item: any, fallbackCollection = ''): Entry {
    if (!item || typeof item !== 'object') return item
    return {
      id: item.id || '',
      collection: item.collection || fallbackCollection,
      rev: item.rev ?? 1,
      seq: item.seq ?? 0,
      created_at: item.created_at || '',
      updated_at: item.updated_at || '',
      data: item.data ?? {},
    }
  }
}
