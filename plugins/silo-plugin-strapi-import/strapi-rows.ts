import { StrapiColumns } from './strapi-columns'
import type { StrapiDatabase } from './strapi-database'
import type { StrapiList } from './strapi-inventory'
import { StrapiInventory } from './strapi-inventory'
import type { StrapiMediaValue } from './strapi-media'
import { StrapiMedia } from './strapi-media'
import type { StrapiVersion } from './strapi-versions'
import { StrapiVersions } from './strapi-versions'

/**
 * The rows of one list, shaped as the entries an import writes.
 *
 * All of them, in memory, and deliberately: the largest list in a reference-data
 * export is a few hundred rows of short strings, the whole point of the source
 * being a staged file is that it is not a live system to be gentle with, and a
 * cursor would buy paging at the cost of holding a database handle open across
 * every `ctx` call the import makes. If a list ever arrives that this cannot
 * hold, the honest fix is a chunked plan and not a lazy reader.
 */
export class StrapiRows {
  /** SQLite's parameter ceiling is 999 by default, and an `IN` list of ids is
   *  the one place here that could reach it. */
  private static readonly Chunk = 500

  static read(
    source: StrapiDatabase,
    list: StrapiList,
    version: StrapiVersion,
    mediaBaseUrl: string,
  ): Record<string, unknown>[] {
    const ids = StrapiRows.idsOf(source, list, version)
    const owner = list.origin === 'component' ? list.component! : list.contentType
    const media = StrapiMedia.valuesOf(source, owner, mediaBaseUrl)

    const rows: Record<string, unknown>[] = []
    for (const batch of StrapiRows.batches(ids)) {
      const placeholders = batch.map(() => '?').join(', ')
      const found = source.rows<Record<string, unknown>>(
        `SELECT * FROM "${list.table}" WHERE id IN (${placeholders})`,
        ...batch,
      )
      // Re-ordered to the id list rather than trusting the `SELECT`: the order
      // came from the join table's `order` column, which is the order the author
      // arranged the list in, and `IN` does not preserve it.
      const byId = new Map(found.map((row) => [Number(row.id), row]))
      for (const id of batch) {
        const row = byId.get(id)
        if (row) rows.push(StrapiRows.shape(list, row, media.get(id) ?? {}))
      }
    }
    return rows
  }

  /** One row → one entry. */
  private static shape(
    list: StrapiList,
    row: Record<string, unknown>,
    media: Record<string, StrapiMediaValue[]>,
  ): Record<string, unknown> {
    const entry: Record<string, unknown> = { strapi_id: Number(row.id) }

    for (const column of list.columns) {
      if (StrapiColumns.schemaFor(column) === null) continue
      entry[column.name] = StrapiColumns.valueFor(column, row[column.name])
    }

    for (const field of list.media) {
      const values = media[field.name] ?? []
      // A field with no file is `null` (or `[]`), not absent. An absent key and a
      // cleared one read the same to every consumer, and only one of them is what
      // the source says.
      entry[field.name] = field.multiple ? values : (values[0] ?? null)
    }
    return entry
  }

  /** The row ids this list is made of, in order. */
  private static idsOf(
    source: StrapiDatabase,
    list: StrapiList,
    version: StrapiVersion,
  ): number[] {
    const contentType = source
      .contentTypes()
      .find((candidate) => candidate.uid === list.contentType)
    if (!contentType) return []

    const entities = StrapiVersions.entityIds(source, contentType, version)
    if (list.origin === 'document') return entities
    return StrapiInventory.componentIds(
      source,
      `${contentType.table}_cmps`,
      entities,
      list.field!,
      list.component!,
    )
  }

  private static batches(ids: readonly number[]): number[][] {
    const batches: number[][] = []
    for (let at = 0; at < ids.length; at += StrapiRows.Chunk) {
      batches.push(ids.slice(at, at + StrapiRows.Chunk) as number[])
    }
    return batches
  }
}
