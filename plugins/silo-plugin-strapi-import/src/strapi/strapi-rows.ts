import type { StrapiDatabase, StrapiStoredType } from './strapi-database'
import { StrapiEntries } from './strapi-entries'
import { StrapiFlattenings } from './strapi-flattening'
import type { StrapiList } from './strapi-inventory'
import type { StrapiMediaSlot } from './strapi-media-slot'
import type { StrapiVersion } from './strapi-versions'
import { StrapiVersions } from './strapi-versions'

/**
 * One source row: the entry as far as a database read can shape it, and where the
 * files its media fields point at belong once they are uploaded.
 *
 * Two fields rather than one finished entry, because filling a media field means
 * uploading bytes — an `await` per file, against silo. Doing that here would make
 * a database read hold an open handle across an HTTP call for every attachment it
 * found; `MediaLibrary.attach` does it where the `ctx` already is.
 */
export interface StrapiRow {
  entry: Record<string, unknown>
  media: StrapiMediaSlot[]
}

/**
 * The rows of one list, shaped as the entries an import writes.
 *
 * All of them, in memory, and deliberately: the largest list in a reference-data
 * export is a few hundred documents, the whole point of the source being a staged
 * file is that it is not a live system to be gentle with, and a cursor would buy
 * paging at the cost of holding a database handle open across every `ctx` call the
 * import makes. If a list ever arrives that this cannot hold, the honest fix is a
 * chunked plan and not a lazy reader.
 *
 * **The version rule is applied here and nowhere below.** `StrapiVersions` names
 * the entity ids of the version being imported, and every component row in the
 * tree is reached from one of them — so the draft copies are not filtered out at
 * each depth, they are never reached. See `StrapiEntries`.
 *
 * `flatten` reads `list.flatten`'s component instead of the wrapper: each item
 * becomes its own `StrapiRow`, with its own scalars, children and media slots —
 * see `StrapiFlattenings` for which lists qualify.
 */
export class StrapiRows {
  static read(
    source: StrapiDatabase,
    list: StrapiList,
    version: StrapiVersion,
    flatten = false,
  ): StrapiRow[] {
    const contentType = source
      .contentTypes()
      .find((candidate) => candidate.uid === list.contentType)
    if (!contentType?.table) return []

    const entities = StrapiVersions.entityIds(source, contentType as StrapiStoredType, version)

    if (flatten) {
      if (!list.flatten) {
        throw new Error(
          `"${list.id}" cannot be flattened: only a single type whose one field is a ` +
            `repeatable component can be imported one entry per item`,
        )
      }
      const child = list.shape.children[0]!
      const itemIds = StrapiFlattenings.itemIds(source, child, list.flatten.component, entities)
      return StrapiEntries.read(source, child.shapes[0]!, itemIds).map((entry) => ({
        entry: entry.value,
        media: entry.media,
      }))
    }

    return StrapiEntries.read(source, list.shape, entities).map((entry) => ({
      entry: entry.value,
      media: entry.media,
    }))
  }
}
