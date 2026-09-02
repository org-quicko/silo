import type { StrapiDatabase, StrapiStoredType } from './strapi-database'
import { StrapiIdentifiers } from './strapi-identifiers'
import type { StrapiChild, StrapiShape } from './strapi-shape'
import { StrapiShapes } from './strapi-shape'
import type { StrapiVersion } from './strapi-versions'
import { StrapiVersions } from './strapi-versions'

/**
 * One Strapi content type, as the silo collection it could become.
 *
 * **One list per content type, single types included**, which is what Strapi
 * itself does: a single type is a table with one row in it, and it holds its
 * components the same way a collection type does. Components are nested inside
 * the entry rather than lifted into collections of their own — see
 * `ImportPlans` for what that replaced and why.
 */
export interface StrapiList {
  /** The content type uid. Stable across a re-read of the same database, so a
   *  plan the operator edited still refers to the same list. */
  id: string
  label: string
  contentType: string
  kind: 'singleType' | 'collectionType'
  /** Where the documents are read from. */
  table: string
  /** The entry: scalars, files and components, at every depth. */
  shape: StrapiShape
  /** Documents in the selected version — what an import would write. */
  count: number
  /** Media fields anywhere in the shape, for the panel to say so at a glance. */
  mediaFields: number
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
 * Every count here is taken through `StrapiVersions`, which is what keeps the
 * number on the plan and the number written the same — see `StrapiVersions` for
 * why that is the rule this importer is correct or wrong by.
 */
export class StrapiInventory {
  static read(source: StrapiDatabase, version: StrapiVersion): StrapiInventory {
    const lists: StrapiList[] = []
    const skipped: { contentType: string; reason: string }[] = []

    for (const contentType of source.contentTypes()) {
      if (!contentType.table) {
        skipped.push({
          contentType: contentType.uid,
          reason:
            `its table "${contentType.collectionName}" is not in this database, under that name ` +
            `or under the shortened one Strapi would have given it ` +
            `("${StrapiIdentifiers.shorten(contentType.collectionName)}")`,
        })
        continue
      }

      const stored = contentType as StrapiStoredType
      const entities = StrapiVersions.entityIds(source, stored, version)
      if (entities.length === 0) {
        skipped.push({ contentType: contentType.uid, reason: `it has no ${version} rows` })
        continue
      }

      const shape = StrapiShapes.forContentType(source, stored)
      if (StrapiShapes.isEmpty(shape)) {
        skipped.push({
          contentType: contentType.uid,
          reason: 'it has no importable fields — only relations and Strapi bookkeeping',
        })
        continue
      }

      lists.push({
        id: contentType.uid,
        label: contentType.displayName,
        contentType: contentType.uid,
        kind: contentType.kind,
        table: stored.table,
        shape,
        count: entities.length,
        mediaFields: StrapiShapes.mediaFields(shape),
        notes: StrapiInventory.notesFor(source, stored, shape, entities.length, version),
      })
    }

    return { version, lists, skipped, media: StrapiInventory.mediaTotals(source) }
  }

  /**
   * The uids these lists' rows are attached by — a content type's own and every
   * component uid nested under it.
   *
   * What scopes a listing of wanted files to this import. A `files` table holds
   * everything the instance ever uploaded, including attachments of content types
   * that were skipped, and asking an operator to supply those would be asking for
   * work the import will not use. Nested uids belong in it because that is where
   * most of the media is: `validation.issue` carries 1646 attachments two levels
   * below the content type that owns it.
   */
  static ownersOf(inventory: StrapiInventory): string[] {
    const owners = new Set<string>()
    for (const list of inventory.lists) {
      for (const uid of StrapiShapes.uidsOf(list.shape)) owners.add(uid)
    }
    return [...owners]
  }

  /**
   * What an operator should read next to this list on the plan.
   *
   * One short line each, and never more than four. These sit in a table of forty
   * rows: what earns a line is what changes a decision about *this* collection,
   * so the media note that used to be here is gone — the panel already prints the
   * field count beside the table name, and the "supply your uploads" half is the
   * whole of section two.
   */
  private static notesFor(
    source: StrapiDatabase,
    contentType: StrapiStoredType,
    shape: StrapiShape,
    count: number,
    version: StrapiVersion,
  ): string[] {
    const notes: string[] = []

    if (contentType.kind === 'singleType') {
      notes.push('A single type, so this collection holds one entry.')
    }

    const total = source.count(contentType.table)
    if (contentType.draftAndPublish && total > count) {
      notes.push(
        `${total} rows in the table, ${count} in the ${version} version. Strapi keeps a copy ` +
          `per version.`,
      )
    }

    const nested = shape.children.map((child) => StrapiInventory.fieldNote(child))
    if (nested.length > 0) {
      notes.push(`Components nested inside the entry: ${nested.join(', ')}.`)
    }

    const unresolved = StrapiShapes.unresolved(shape)
    if (unresolved.length > 0) {
      notes.push(
        `No table could be proved for ${unresolved.join(', ')}, so those fields will be missing ` +
          `from every entry. Strapi names a component's table from a pluralised form of its uid, ` +
          `and that mapping is in the project's src/components files rather than the export.`,
      )
    }
    return notes
  }

  /** `features (list)` — the field, and what it holds where that is not obvious. */
  private static fieldNote(child: StrapiChild): string {
    if (child.kind === 'repeatable') return `${child.field} (list)`
    if (child.kind === 'zone') return `${child.field} (dynamic zone)`
    return child.field
  }

  private static mediaTotals(source: StrapiDatabase): { files: number; attached: number } {
    const files = source.hasTable('files') ? source.count('files') : 0
    const attached = source.hasTable('files_related_mph') ? source.count('files_related_mph') : 0
    return { files, attached }
  }
}
