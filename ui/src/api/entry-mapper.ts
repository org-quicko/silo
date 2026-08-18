import type { Entry } from './types/entry'

// The API returns either an enveloped entry (`{ id, rev, …, data }`) or a flat
// object whose non-envelope keys are the data; both shapes normalize to `Entry`.
export class EntryMapper {
  static fromApiEntry(item: any, fallbackCollection = ''): Entry {
    if (!item) return item
    if (item.data && typeof item.data === 'object') {
      return {
        id: item.id || '',
        collection: item.collection || fallbackCollection,
        rev: item.rev ?? 1,
        seq: item.seq ?? 0,
        created_at: item.created_at || '',
        updated_at: item.updated_at || '',
        data: item.data,
      }
    }
    const { id, created_at, updated_at, collection: colName, rev, seq, ...data } = item
    return {
      id: id || '',
      collection: colName || fallbackCollection,
      rev: rev ?? 1,
      seq: seq ?? 0,
      created_at: created_at || '',
      updated_at: updated_at || '',
      data,
    }
  }
}
