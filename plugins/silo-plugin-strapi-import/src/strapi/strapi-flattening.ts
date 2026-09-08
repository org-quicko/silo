import type { StrapiDatabase, StrapiStoredType } from './strapi-database'
import type { StrapiChild, StrapiShape } from './strapi-shape'
import type { StrapiVersion } from './strapi-versions'
import { StrapiVersions } from './strapi-versions'

/** How a single type could be imported as one entry per component item, instead
 *  of one entry holding all of them. See `README.md`, "Flattening a single
 *  type", for the eligibility rule and why it is safe for this one shape. */
export interface StrapiFlattening {
  /** The wrapper's one field. */
  field: string
  /** The component uid each entry would be. */
  component: string
  /** Items in the selected version, so the plan can say how many entries. */
  count: number
}

/**
 * Whether a single type is nothing but a wrapper around one repeatable
 * component, and the rows that wrapper holds.
 *
 * **Strict on purpose.** The general lift this replaces cost real content —
 * see `ImportPlans` — and every one of those losses needs a field the wrapper
 * itself contributes, a sibling component, or a second content type sharing the
 * name. A list with none of those is the one case where flattening loses
 * nothing: the wrapper has no columns of its own, the component's children stay
 * nested inside each flattened entry, and there is exactly one component to name
 * the collection after.
 */
export class StrapiFlattenings {
  /** SQLite's parameter ceiling, matching `StrapiEntries.linksOf`. */
  private static readonly Chunk = 500

  /** The flattening this list allows, or `null`. */
  static of(
    source: StrapiDatabase,
    contentType: StrapiStoredType,
    shape: StrapiShape,
    version: StrapiVersion,
  ): StrapiFlattening | null {
    if (contentType.kind !== 'singleType') return null

    const child = StrapiFlattenings.eligibleChild(shape)
    if (!child) return null

    const component = child.shapes[0]!.uid
    const entities = StrapiVersions.entityIds(source, contentType, version)
    const count = StrapiFlattenings.itemIds(source, child, component, entities).length
    return { field: child.field, component, count }
  }

  /** The component row ids under `child` for these entity ids, in the author's
   *  order. */
  static itemIds(
    source: StrapiDatabase,
    child: StrapiChild,
    component: string,
    entities: readonly number[],
  ): number[] {
    const ids: number[] = []
    const wanted = [...new Set(entities)]
    for (let at = 0; at < wanted.length; at += StrapiFlattenings.Chunk) {
      const batch = wanted.slice(at, at + StrapiFlattenings.Chunk)
      const placeholders = batch.map(() => '?').join(', ')
      ids.push(
        ...source
          .rows<{ cmp_id: number }>(
            `SELECT cmp_id FROM "${child.join}" WHERE field = ? AND component_type = ? ` +
              `AND entity_id IN (${placeholders}) ORDER BY entity_id, "order", id`,
            child.field,
            component,
            ...batch,
          )
          .map((row) => row.cmp_id),
      )
    }
    return ids
  }

  /** The one child a flattening could be built from, or `null` — a shape with
   *  any column, media field or open field of its own, or more than one child,
   *  or an unresolved component, is not one. */
  private static eligibleChild(shape: StrapiShape): StrapiChild | null {
    if (shape.columns.length > 0 || shape.media.length > 0 || shape.emptyFields.length > 0) {
      return null
    }
    if (shape.children.length !== 1) return null

    const child = shape.children[0]!
    if (child.kind !== 'repeatable' || child.shapes.length !== 1 || child.unresolved.length > 0) {
      return null
    }
    return child
  }
}
