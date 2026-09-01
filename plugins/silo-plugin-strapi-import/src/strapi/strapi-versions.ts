import type { StrapiContentType, StrapiDatabase } from './strapi-database'

export type StrapiVersion = 'published' | 'draft'

/**
 * Which of a document's rows belong to the version being imported.
 *
 * **One place, because this is the rule the whole importer is correct or wrong
 * by.** Strapi 5 stores a row per version of every document, and a repeatable
 * component's rows are duplicated along with it: a 29-item list is 58 rows in
 * `components_…`, half owned by the draft copy and half by the published one,
 * with the media attached to both. Reading a component table directly therefore
 * imports every row twice — and it fails silently, because there is no error, no
 * duplicate id, and no way to tell 58 rows of data from 29 rows of data twice
 * without knowing the source.
 *
 * The inventory counts through this and the reader reads through it, so the
 * number on the plan and the number written cannot disagree. Two copies of the
 * clause would be two chances to fix one of them.
 */
export class StrapiVersions {
  static readonly All: readonly StrapiVersion[] = ['published', 'draft']

  static isVersion(value: unknown): value is StrapiVersion {
    return typeof value === 'string' && (StrapiVersions.All as readonly string[]).includes(value)
  }

  /**
   * The entity ids of `contentType` in `version`, in id order.
   *
   * Two fallbacks, and both are about not dropping real content:
   *
   * - A content type with draft-and-publish **off** has one row per document and
   *   a `published_at` that means nothing, so every row is the answer.
   * - An empty result falls back to every row. A document that has never been
   *   published exists only as a draft, and answering "nothing to import" for a
   *   content type full of unpublished content would be the worst kind of
   *   correct.
   */
  static entityIds(
    source: StrapiDatabase,
    contentType: StrapiContentType,
    version: StrapiVersion,
  ): number[] {
    const all = StrapiVersions.query(source, contentType.table)
    if (!contentType.draftAndPublish) return all

    const clause = version === 'published' ? 'IS NOT NULL' : 'IS NULL'
    const selected = StrapiVersions.query(
      source,
      contentType.table,
      `WHERE published_at ${clause}`,
    )
    return selected.length > 0 ? selected : all
  }

  private static query(source: StrapiDatabase, table: string, where = ''): number[] {
    return source
      .rows<{ id: number }>(`SELECT id FROM "${table}" ${where} ORDER BY id`)
      .map((row) => row.id)
  }
}
