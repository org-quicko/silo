import { StrapiColumns } from './strapi-columns'
import type { StrapiDatabase } from './strapi-database'
import { StrapiMedia } from './strapi-media'
import type { StrapiMediaSlot } from './strapi-media-slot'
import { StrapiMediaSlots } from './strapi-media-slot'
import type { StrapiChild, StrapiShape } from './strapi-shape'

/** One built row: the entry as far as a database read can shape it, and where
 *  its files go once they have been uploaded. */
export interface StrapiEntry {
  value: Record<string, unknown>
  media: StrapiMediaSlot[]
}

/**
 * Rows, with their components nested inside them.
 *
 * **Breadth-first, one query per level per field**, which is the difference
 * between an import and a stall: 30 applications each holding a `connection`
 * holding an `oauth` is three queries here and ninety if the recursion were per
 * row, against a file that is being read while an operator watches a progress
 * bar.
 *
 * Nothing in here knows about document versions. The caller hands down the
 * entity ids of the version being imported, every component row is reached
 * *from* one of those ids through the join table, and Strapi gives each version
 * its own copy of every component row — so the version rule applies once, at the
 * top, and the whole tree below it is the right half by construction. That is
 * the trap `StrapiVersions` exists for, closed by shape rather than by a clause
 * repeated at every depth.
 */
export class StrapiEntries {
  /** SQLite's parameter ceiling is 999 by default, and an `IN` list of ids is
   *  the one place here that could reach it. */
  private static readonly Chunk = 500

  /** The rows of `ids`, in the order given, skipping any the table does not
   *  hold. */
  static read(source: StrapiDatabase, shape: StrapiShape, ids: readonly number[]): StrapiEntry[] {
    const built = StrapiEntries.build(source, shape, ids)
    const entries: StrapiEntry[] = []
    for (const id of ids) {
      const entry = built.get(id)
      if (entry) entries.push(entry)
    }
    return entries
  }

  /** Every row of one shape, by id, with its children already nested. */
  private static build(
    source: StrapiDatabase,
    shape: StrapiShape,
    ids: readonly number[],
  ): Map<number, StrapiEntry> {
    const entries = new Map<number, StrapiEntry>()
    const wanted = [...new Set(ids)]
    if (wanted.length === 0) return entries

    // One query for the whole level's files rather than one per row: 988 issue
    // rows with two icon fields each would otherwise be 1976 queries.
    const files = StrapiMedia.filesOf(source, shape.uid)

    for (const batch of StrapiEntries.batches(wanted)) {
      const placeholders = batch.map(() => '?').join(', ')
      const rows = source.rows<Record<string, unknown>>(
        `SELECT * FROM "${shape.table}" WHERE id IN (${placeholders})`,
        ...batch,
      )
      for (const row of rows) {
        const id = Number(row.id)
        entries.set(id, {
          value: StrapiEntries.scalars(shape, row),
          media: shape.media.map((field) => ({
            path: [field.name],
            multiple: field.multiple,
            files: files.get(id)?.[field.name] ?? [],
          })),
        })
      }
    }

    for (const child of shape.children) StrapiEntries.nest(source, child, wanted, entries)
    return entries
  }

  /** The scalar half of one entry. */
  private static scalars(shape: StrapiShape, row: Record<string, unknown>): Record<string, unknown> {
    const value: Record<string, unknown> = {}
    for (const column of shape.columns) {
      if (StrapiColumns.schemaFor(column) === null) continue
      value[column.name] = StrapiColumns.valueFor(column, row[column.name])
    }
    return value
  }

  /** Read one component field for a whole level, and hang it on its parents. */
  private static nest(
    source: StrapiDatabase,
    child: StrapiChild,
    ids: readonly number[],
    parents: Map<number, StrapiEntry>,
  ): void {
    const links = StrapiEntries.linksOf(source, child, ids)

    // One recursion per component uid — a dynamic zone holds several, and each
    // is its own table.
    const built = new Map<string, Map<number, StrapiEntry>>()
    for (const shape of child.shapes) {
      const wanted = links.filter((link) => link.component_type === shape.uid).map((link) => link.cmp_id)
      built.set(shape.uid, StrapiEntries.build(source, shape, wanted))
    }

    const byParent = new Map<number, StrapiLink[]>()
    for (const link of links) {
      byParent.set(link.entity_id, [...(byParent.get(link.entity_id) ?? []), link])
    }

    for (const id of ids) {
      const parent = parents.get(id)
      if (!parent) continue
      const own = byParent.get(id) ?? []

      if (child.kind === 'single') {
        const found = own[0] ? built.get(own[0].component_type)?.get(own[0].cmp_id) : undefined
        // `null` and not an absent key: a component nobody filled and a component
        // that was cleared read the same to every consumer, and only one of them
        // is what the source says.
        parent.value[child.field] = found ? found.value : null
        if (found) parent.media.push(...StrapiMediaSlots.nest(found.media, [child.field]))
        continue
      }

      const values: unknown[] = []
      for (const link of own) {
        const found = built.get(link.component_type)?.get(link.cmp_id)
        if (!found) continue
        const index = values.length
        // A dynamic zone's items say which component they are, the way Strapi's
        // own API reports them. A repeatable field holds one component and needs
        // no discriminator.
        values.push(
          child.kind === 'zone' ? { __component: link.component_type, ...found.value } : found.value,
        )
        parent.media.push(...StrapiMediaSlots.nest(found.media, [child.field, index]))
      }
      parent.value[child.field] = values
    }
  }

  /**
   * The join rows of one field, in the order the author arranged them.
   *
   * `"order"` is `NULL` on a single component and 1-based on a repeatable one,
   * and `id` breaks the tie so two rows written in one save keep the order they
   * were written in.
   */
  private static linksOf(
    source: StrapiDatabase,
    child: StrapiChild,
    ids: readonly number[],
  ): StrapiLink[] {
    const links: StrapiLink[] = []
    for (const batch of StrapiEntries.batches(ids)) {
      const placeholders = batch.map(() => '?').join(', ')
      links.push(
        ...source.rows<StrapiLink>(
          `SELECT entity_id, cmp_id, component_type FROM "${child.join}"
            WHERE field = ? AND entity_id IN (${placeholders})
         ORDER BY entity_id, "order", id`,
          child.field,
          ...batch,
        ),
      )
    }
    return links
  }

  private static batches(ids: readonly number[]): number[][] {
    const batches: number[][] = []
    for (let at = 0; at < ids.length; at += StrapiEntries.Chunk) {
      batches.push(ids.slice(at, at + StrapiEntries.Chunk) as number[])
    }
    return batches
  }
}

/** One row of a `_cmps` table, as far as the reader needs it. */
interface StrapiLink {
  entity_id: number
  cmp_id: number
  component_type: string
}
