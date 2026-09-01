import { StrapiComponents } from './strapi-components'
import type { StrapiColumn } from './strapi-columns'
import type { StrapiContentType, StrapiDatabase } from './strapi-database'
import type { StrapiMediaField } from './strapi-media'
import { StrapiMedia } from './strapi-media'
import type { StrapiVersion } from './strapi-versions'
import { StrapiVersions } from './strapi-versions'

/**
 * One list of rows in the export that could become a silo collection.
 *
 * Two things produce one: a repeatable component attribute — where the rows are
 * the component's own — and a content type's own documents. Both are "a table of
 * things", which is what a silo collection is, so they are one shape here rather
 * than two the plan would have to branch on.
 */
export interface StrapiList {
  /** Stable across a re-read of the same database, so a plan the operator edited
   *  still refers to the same list. */
  id: string
  label: string
  origin: 'component' | 'document'
  contentType: string
  contentTypeKind: 'singleType' | 'collectionType'
  /** The attribute the component list hangs off, or `null` for documents. */
  field: string | null
  component: string | null
  /** Where the rows are read from. */
  table: string
  columns: StrapiColumn[]
  media: StrapiMediaField[]
  /** Rows in the selected document version — what an import would write. */
  count: number
  /** Anything about this list an operator should read before importing it. */
  notes: string[]
}

export interface StrapiInventory {
  version: StrapiVersion
  lists: StrapiList[]
  /** Content types nothing could be read from, and why. Reported rather than
   *  omitted: a content type that silently vanished from the plan is the one an
   *  operator will notice missing after the import. */
  skipped: { contentType: string; reason: string }[]
  media: { files: number; attached: number }
}

/**
 * What is in a Strapi export, as lists an import could write.
 *
 * Every count here is taken through `StrapiVersions` and the join table rather
 * than from the component table, which is what keeps the number on the plan and
 * the number written the same — see `StrapiVersions` for why that is the rule this
 * importer is correct or wrong by.
 */
export class StrapiInventory {
  static read(source: StrapiDatabase, version: StrapiVersion): StrapiInventory {
    const lists: StrapiList[] = []
    const skipped: { contentType: string; reason: string }[] = []

    for (const contentType of source.contentTypes()) {
      if (!source.hasTable(contentType.table)) {
        skipped.push({
          contentType: contentType.uid,
          reason: `its table "${contentType.table}" is not in this database`,
        })
        continue
      }

      const entities = StrapiVersions.entityIds(source, contentType, version)
      const components = StrapiInventory.componentLists(source, contentType, entities, version)
      lists.push(...components.lists)

      const documents = StrapiInventory.documentList(source, contentType, entities, version)
      if (documents) lists.push(documents)

      for (const component of components.unresolved) {
        skipped.push({
          contentType: contentType.uid,
          reason:
            `its component "${component}" could not be matched to a table in this database. ` +
            `Strapi names a component's table from a pluralised form of its uid, and the ` +
            `mapping is in the project's src/components files rather than the export.`,
        })
      }

      if (components.lists.length === 0 && components.unresolved.length === 0 && !documents) {
        skipped.push({
          contentType: contentType.uid,
          reason:
            entities.length === 0
              ? `it has no ${version} rows`
              : 'it has no importable fields — only relations and Strapi bookkeeping',
        })
      }
    }

    return { version, lists, skipped, media: StrapiInventory.mediaTotals(source) }
  }

  /**
   * One list per component attribute, and one `unresolved` entry per attribute
   * whose table could not be found.
   *
   * Reported rather than dropped. `StrapiComponents` refuses to guess when it
   * cannot prove a table, and a content type that then vanished from the plan
   * with a message about having "no importable fields" would be a false
   * explanation of a real problem — measured exactly that way against this
   * plugin's first live run.
   */
  private static componentLists(
    source: StrapiDatabase,
    contentType: StrapiContentType,
    entities: number[],
    version: StrapiVersion,
  ): { lists: StrapiList[]; unresolved: string[] } {
    const join = `${contentType.table}_cmps`
    if (!source.hasTable(join) || entities.length === 0) return { lists: [], unresolved: [] }

    const lists: StrapiList[] = []
    const unresolved: string[] = []
    for (const [field, attribute] of Object.entries(contentType.attributes)) {
      if (attribute.type !== 'component' || !attribute.component) continue

      const ids = StrapiInventory.componentIds(source, join, entities, field, attribute.component)
      const table = StrapiComponents.tableFor(source, attribute.component, ids)
      if (!table) {
        unresolved.push(attribute.component)
        continue
      }

      const columns = source.columns(table)
      const media = StrapiMedia.fieldsOf(source, attribute.component)
      const notes: string[] = []
      if (!attribute.repeatable) {
        notes.push(
          'This is a single component, not a repeatable list, so the collection holds one entry.',
        )
      }
      const total = source.count(table)
      if (contentType.draftAndPublish && total > ids.length) {
        notes.push(
          `${total} rows are in "${table}"; ${ids.length} of them belong to the ${version} ` +
            `version. Strapi keeps a copy per version, so the rest are the other one.`,
        )
      }
      if (media.length > 0) {
        notes.push(
          `${media.map((field) => field.name).join(', ')} hold uploaded files. Supply Strapi's ` +
            `uploads directory and they import into silo's media library; without it they keep ` +
            `their Strapi URL.`,
        )
      }

      lists.push({
        id: `${contentType.uid}#${field}`,
        label: `${contentType.displayName} → ${field}`,
        origin: 'component',
        contentType: contentType.uid,
        contentTypeKind: contentType.kind,
        field,
        component: attribute.component,
        table,
        columns,
        media,
        count: ids.length,
        notes,
      })
    }
    return { lists, unresolved }
  }

  /**
   * The content type's own rows, when it has fields of its own worth importing.
   *
   * A single type whose only attribute is a component list produces nothing here,
   * which is right: the collection worth having is the list, and a one-entry
   * collection holding nothing but timestamps is noise on the plan.
   */
  private static documentList(
    source: StrapiDatabase,
    contentType: StrapiContentType,
    entities: number[],
    version: StrapiVersion,
  ): StrapiList | null {
    const scalars = Object.entries(contentType.attributes).filter(
      ([, attribute]) => !['component', 'relation', 'dynamiczone', 'media'].includes(attribute.type),
    )
    if (scalars.length === 0 || entities.length === 0) return null

    // Only the columns the author declared. `document_id` used to be forced in
    // beside them as provenance, and it goes for the same reason `strapi_id` did:
    // silo mints its own identity (D2), and a Strapi id carried into a silo entry
    // is a field nothing here resolves.
    const names = new Set(scalars.map(([name]) => StrapiInventory.column(name)))
    const columns = source.columns(contentType.table).filter((column) => names.has(column.name))

    if (columns.length === 0) return null

    const media = StrapiMedia.fieldsOf(source, contentType.uid)
    return {
      id: contentType.uid,
      label: contentType.displayName,
      origin: 'document',
      contentType: contentType.uid,
      contentTypeKind: contentType.kind,
      field: null,
      component: null,
      table: contentType.table,
      columns,
      media,
      count: entities.length,
      notes:
        contentType.kind === 'singleType'
          ? ['A single type, so this collection holds one entry.']
          : [],
    }
  }

  /** The component row ids of one attribute, in the order Strapi stores them,
   *  restricted to the chosen version's entities. */
  static componentIds(
    source: StrapiDatabase,
    join: string,
    entities: number[],
    field: string,
    component: string,
  ): number[] {
    if (entities.length === 0) return []
    const placeholders = entities.map(() => '?').join(', ')
    return source
      .rows<{ cmp_id: number }>(
        `SELECT cmp_id FROM "${join}"
          WHERE component_type = ? AND field = ? AND entity_id IN (${placeholders})
       ORDER BY entity_id, "order"`,
        component,
        field,
        ...entities,
      )
      .map((row) => row.cmp_id)
  }

  /** Strapi's attribute names are camelCase and its columns are snake_case. */
  private static column(attribute: string): string {
    return attribute.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
  }

  /**
   * The `related_type` values these lists' rows are attached by — a component uid
   * for a component list, a content-type uid for a document list.
   *
   * What scopes a listing of wanted files to this import. A `files` table holds
   * everything the instance ever uploaded, including attachments of content types
   * that were skipped, and asking an operator to supply those would be asking for
   * work the import will not use.
   */
  static ownersOf(inventory: StrapiInventory): string[] {
    const owners = new Set<string>()
    for (const list of inventory.lists) {
      owners.add(list.origin === 'component' ? list.component! : list.contentType)
    }
    return [...owners]
  }

  private static mediaTotals(source: StrapiDatabase): { files: number; attached: number } {
    const files = source.hasTable('files') ? source.count('files') : 0
    const attached = source.hasTable('files_related_mph') ? source.count('files_related_mph') : 0
    return { files, attached }
  }
}
