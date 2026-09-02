import type { StrapiColumn } from './strapi-columns'
import { StrapiComponents } from './strapi-components'
import type { StrapiDatabase, StrapiStoredType } from './strapi-database'
import { StrapiFields } from './strapi-fields'
import { StrapiIdentifiers } from './strapi-identifiers'
import type { StrapiMediaField } from './strapi-media'
import { StrapiMedia } from './strapi-media'

/**
 * What one row of a Strapi table becomes: its own scalars and files, and the
 * component rows hanging off it.
 *
 * The same shape describes a content type and a component, because Strapi stores
 * them the same way — a table of rows, a `_cmps` join table naming the children,
 * and `files_related_mph` naming the files — and the nesting terminates only
 * because a leaf component has no join table.
 */
export interface StrapiShape {
  /** The content type or component uid these rows belong to. `files_related_mph`
   *  is keyed on it. */
  uid: string
  /** The physical table the rows are in. */
  table: string
  columns: StrapiColumn[]
  media: StrapiMediaField[]
  children: StrapiChild[]
  /** Fields Strapi declares that this export holds no rows for, so their kind
   *  could not be read. Kept on the collection as open properties rather than
   *  dropped — a field an operator can see in Strapi and not in silo reads as
   *  data loss, and it is not. */
  emptyFields: string[]
}

/** One component or dynamic-zone field, and the shapes it holds. */
export interface StrapiChild {
  field: string
  /** `single` holds one object or `null`, `repeatable` an array of one shape,
   *  `zone` an array whose items each name the component they are. */
  kind: 'single' | 'repeatable' | 'zone'
  /** The `_cmps` table the parent's rows reach these through. */
  join: string
  shapes: StrapiShape[]
  /** Component uids this field names that no table could be proved for. Carried
   *  rather than dropped: a field missing from an imported entry is the thing an
   *  operator notices last. */
  unresolved: string[]
}

/** A component field as the content-type schema declares it. */
interface DeclaredChild {
  kind: StrapiChild['kind']
  components: string[]
}

/**
 * Reading Strapi's storage layout as the shape of an entry.
 *
 * **The component schemas are not in the export**, and that is the fact this
 * file is built around. `strapi_content_types_schema` records what a content
 * type declares — including which of its fields are components — and stops
 * there: what `com-quicko-app-store.connection` itself holds lives in
 * `src/components/*.json`, which a database export does not carry. So a
 * component's own shape is read from the *data*: its table's columns are its
 * scalars, its `_cmps` join table names its children, and `files_related_mph`
 * names its files.
 *
 * Reading data has one limit, and both halves of the answer to it are here. A
 * field declared and never filled has no rows to be read, so nothing in the data
 * says it exists — `StrapiFields` names it anyway, from the content-manager
 * configuration, and it lands in `emptyFields` as a property with no type rather
 * than as a field that quietly is not there. What no source in the export can
 * say is that field's *kind*, so nothing here pretends to.
 *
 * The same reading decides a nested component's `repeatable` from whether any
 * one row holds more than one child, the way `StrapiMedia` decides `multiple`.
 * A content type's own fields never need that: its schema says.
 */
export class StrapiShapes {
  /** Deep enough for any real model, and a stop for one that points at itself. */
  private static readonly MaxDepth = 8

  /** Attribute types that are not a column of their own table. */
  private static readonly Structural = ['component', 'dynamiczone', 'relation', 'media']

  /** The shape of a content type's own rows. */
  static forContentType(source: StrapiDatabase, contentType: StrapiStoredType): StrapiShape {
    const children = StrapiShapes.children(
      source,
      [contentType.collectionName, contentType.table],
      StrapiShapes.declaredChildren(contentType),
      new Set([contentType.uid]),
      0,
    )
    return {
      uid: contentType.uid,
      table: contentType.table,
      columns: StrapiShapes.declaredColumns(source, contentType),
      media: StrapiShapes.declaredMedia(source, contentType),
      children,
      // A component field the schema declares and the export never filled. The
      // content type's own schema is complete, so this is the whole of what is
      // missing rather than a guess at it.
      emptyFields: [...StrapiShapes.declaredChildren(contentType).keys()].filter(
        (field) => !children.some((child) => child.field === field),
      ),
    }
  }

  /** Every uid a shape reads rows for, itself included — what a media listing is
   *  scoped to, and what `files_related_mph` is keyed on. */
  static uidsOf(shape: StrapiShape): string[] {
    const uids = [shape.uid]
    for (const child of shape.children) {
      for (const nested of child.shapes) uids.push(...StrapiShapes.uidsOf(nested))
    }
    return uids
  }

  /** Media fields anywhere in the shape. */
  static mediaFields(shape: StrapiShape): number {
    let total = shape.media.length
    for (const child of shape.children) {
      for (const nested of child.shapes) total += StrapiShapes.mediaFields(nested)
    }
    return total
  }

  /** Component uids nothing could be read for, at any depth. */
  static unresolved(shape: StrapiShape): string[] {
    const missing: string[] = []
    for (const child of shape.children) {
      missing.push(...child.unresolved)
      for (const nested of child.shapes) missing.push(...StrapiShapes.unresolved(nested))
    }
    return [...new Set(missing)]
  }

  /** Whether there is anything in here an import would write. */
  static isEmpty(shape: StrapiShape): boolean {
    return shape.columns.length === 0 && shape.media.length === 0 && shape.children.length === 0
  }

  /**
   * The media fields of a content type: the ones its schema declares, plus any
   * the data holds that it does not.
   *
   * Declared first because the schema is the better source where there is one —
   * it names a field with no attachments in this export, and it states `multiple`
   * rather than leaving `StrapiMedia` to infer it from whether any one row
   * happens to hold two files. A component gets no such help, which is why
   * `forComponent` reads the data alone.
   */
  private static declaredMedia(
    source: StrapiDatabase,
    contentType: StrapiStoredType,
  ): StrapiMediaField[] {
    const observed = StrapiMedia.fieldsOf(source, contentType.uid)
    const fields: StrapiMediaField[] = []
    const named = new Set<string>()

    for (const [name, attribute] of Object.entries(contentType.attributes)) {
      if (attribute.type !== 'media') continue
      named.add(name)
      fields.push({
        name,
        multiple: attribute.multiple === true,
        rows: observed.find((field) => field.name === name)?.rows ?? 0,
      })
    }
    return [...fields, ...observed.filter((field) => !named.has(field.name))]
  }

  /** One component's rows, and whatever hangs off them. */
  private static forComponent(
    source: StrapiDatabase,
    uid: string,
    table: string,
    seen: ReadonlySet<string>,
    depth: number,
  ): StrapiShape {
    const columns = source.columns(table)
    const media = StrapiMedia.fieldsOf(source, uid)
    // A component's *types* are declared nowhere in the export, so its join table
    // is the only statement of what it holds.
    const children = StrapiShapes.children(source, [table], null, new Set(seen).add(uid), depth)

    const read = new Set([
      ...columns.map((column) => column.name),
      ...media.map((field) => field.name),
      ...children.map((child) => child.field),
    ])
    return {
      uid,
      table,
      columns,
      media,
      children,
      emptyFields: StrapiFields.of(source, uid).filter((field) => !read.has(field)),
    }
  }

  /**
   * The component fields of one table, from what it declares and what it holds.
   *
   * `declared` is the content-type schema's answer, and it wins on `kind`
   * because it is a statement where the data is an inference: a repeatable field
   * every row happens to fill once is still a list, and no amount of reading
   * rows can say so. The join table adds any field the schema did not mention,
   * which is what keeps a component's own children — where there is no schema at
   * all — from being invisible.
   */
  private static children(
    source: StrapiDatabase,
    tables: readonly string[],
    declared: Map<string, DeclaredChild> | null,
    seen: ReadonlySet<string>,
    depth: number,
  ): StrapiChild[] {
    if (depth >= StrapiShapes.MaxDepth) return []
    const join = StrapiShapes.joinTable(source, tables)
    if (!join) return []

    const held = StrapiShapes.heldBy(source, join)
    const widest = StrapiShapes.widestOf(source, join)

    const children: StrapiChild[] = []
    for (const field of new Set([...(declared?.keys() ?? []), ...held.keys()])) {
      const found = held.get(field) ?? []
      const components = [...new Set([...(declared?.get(field)?.components ?? []), ...found])]

      const shapes: StrapiShape[] = []
      const unresolved: string[] = []
      for (const uid of components) {
        if (seen.has(uid)) continue
        const ids = StrapiShapes.componentIds(source, join, field, uid)
        const table = StrapiComponents.tableFor(source, uid, ids)
        if (table) shapes.push(StrapiShapes.forComponent(source, uid, table, seen, depth + 1))
        else unresolved.push(uid)
      }
      if (shapes.length === 0 && unresolved.length === 0) continue

      children.push({
        field,
        kind:
          declared?.get(field)?.kind ??
          (found.length > 1 ? 'zone' : (widest.get(field) ?? 1) > 1 ? 'repeatable' : 'single'),
        join,
        shapes,
        unresolved,
      })
    }
    return children
  }

  /** Which component uids each field of a join table actually holds. */
  private static heldBy(source: StrapiDatabase, join: string): Map<string, string[]> {
    const held = new Map<string, string[]>()
    const rows = source.rows<{ field: string; component_type: string }>(
      `SELECT DISTINCT field, component_type FROM "${join}"
        WHERE field IS NOT NULL AND component_type IS NOT NULL
     ORDER BY field, component_type`,
    )
    for (const row of rows) {
      held.set(row.field, [...(held.get(row.field) ?? []), row.component_type])
    }
    return held
  }

  /** The most children any one row holds, per field — what says "repeatable"
   *  where no schema does. */
  private static widestOf(source: StrapiDatabase, join: string): Map<string, number> {
    const rows = source.rows<{ field: string; most: number }>(
      `SELECT field, MAX(per_row) AS most
         FROM (SELECT field, entity_id, COUNT(*) AS per_row
                 FROM "${join}" WHERE field IS NOT NULL GROUP BY field, entity_id)
     GROUP BY field`,
    )
    return new Map(rows.map((row) => [row.field, row.most] as const))
  }

  private static declaredChildren(contentType: StrapiStoredType): Map<string, DeclaredChild> {
    const declared = new Map<string, DeclaredChild>()
    for (const [field, attribute] of Object.entries(contentType.attributes)) {
      if (attribute.type === 'component' && attribute.component) {
        declared.set(field, {
          kind: attribute.repeatable ? 'repeatable' : 'single',
          components: [attribute.component],
        })
      } else if (attribute.type === 'dynamiczone') {
        declared.set(field, { kind: 'zone', components: attribute.components ?? [] })
      }
    }
    return declared
  }

  /**
   * The columns of a content type's table that its author declared, in table
   * order.
   *
   * Strapi's attribute names are camelCase and its columns snake_case. What is
   * left out is Strapi's own bookkeeping — `document_id`, `published_at`, the
   * two `created_by` keys — because silo mints its own identity (D2) and a
   * Strapi id in a silo entry is a field nothing on either side resolves.
   */
  private static declaredColumns(
    source: StrapiDatabase,
    contentType: StrapiStoredType,
  ): StrapiColumn[] {
    const names = new Set(
      Object.entries(contentType.attributes)
        .filter(([, attribute]) => !StrapiShapes.Structural.includes(attribute.type))
        .map(([name]) => name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()),
    )
    return source.columns(contentType.table).filter((column) => names.has(column.name))
  }

  /** The rows of one component under one field, for `StrapiComponents` to prove a
   *  table with. Every version's, because a table either holds a row or does not
   *  and the draft copies only make the proof stronger. */
  private static componentIds(
    source: StrapiDatabase,
    join: string,
    field: string,
    component: string,
  ): number[] {
    return source
      .rows<{ cmp_id: number }>(
        `SELECT cmp_id FROM "${join}" WHERE field = ? AND component_type = ? ORDER BY cmp_id`,
        field,
        component,
      )
      .map((row) => row.cmp_id)
  }

  /** The `_cmps` table of a base name, under any spelling Strapi may have
   *  shortened it to. */
  private static joinTable(source: StrapiDatabase, tables: readonly string[]): string | null {
    for (const table of new Set(tables)) {
      for (const spelling of StrapiIdentifiers.spellings(`${table}_cmps`)) {
        if (source.hasTable(spelling)) return spelling
      }
    }
    return null
  }
}
