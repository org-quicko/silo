import type { StrapiDatabase } from './strapi-database'

/** One field of a Strapi row that holds uploaded files. */
export interface StrapiMediaField {
  name: string
  /** Whether any single row holds more than one file. Decided from the data
   *  rather than from the schema, because a component's own attribute list is
   *  not in the export — and one answer for the whole field keeps the generated
   *  JSON Schema from being a union. */
  multiple: boolean
  /** How many rows of this list have at least one file in this field. */
  rows: number
}

/** A file as it reaches a silo entry. */
export interface StrapiMediaValue {
  url: string
  name: string | null
  mime: string | null
  width: number | null
  height: number | null
  /** Bytes, as Strapi records it — kilobytes, so it is converted. */
  size: number | null
  alt: string | null
}

/**
 * Strapi's media catalog, as far as an import can carry it.
 *
 * **The bytes are not here, and cannot be.** A `strapi transfer` database holds
 * the `files` table — names, dimensions, MIME types and `/uploads/…` paths — and
 * the files themselves live in the Strapi instance's `public/uploads` directory
 * or in whatever provider it was configured with. So a media reference imports
 * as a **URL**, absolutised against `media_base_url`, and this plugin does not
 * pretend otherwise. Bringing the bytes across is `silo media upload` against
 * the same URLs, which is a second job with its own failure modes and does not
 * belong inside a database read.
 */
export class StrapiMedia {
  /** The join table, and the two columns that make it polymorphic. */
  private static readonly Table = 'files_related_mph'

  /** Which fields of `owner` hold files, and whether any row holds more than
   *  one. `owner` is a component uid for a component list, or a content-type
   *  uid for a content type's own rows. */
  static fieldsOf(source: StrapiDatabase, owner: string): StrapiMediaField[] {
    if (!source.hasTable(StrapiMedia.Table)) return []

    const rows = source.rows<{ field: string; rows: number; most: number }>(
      `SELECT field, COUNT(DISTINCT related_id) AS rows, MAX(per_row) AS most
         FROM (SELECT field, related_id, COUNT(*) AS per_row
                 FROM "${StrapiMedia.Table}"
                WHERE related_type = ? AND field IS NOT NULL
             GROUP BY field, related_id)
     GROUP BY field
     ORDER BY field`,
      owner,
    )
    return rows.map((row) => ({ name: row.field, multiple: row.most > 1, rows: row.rows }))
  }

  /**
   * Every file attached to `owner`, by the row it belongs to.
   *
   * One query for the whole list rather than one per row: 500 rows with two
   * media fields each would otherwise be 1000 queries against a staged file, and
   * the join is what a database is for.
   */
  static valuesOf(
    source: StrapiDatabase,
    owner: string,
    baseUrl: string,
  ): Map<number, Record<string, StrapiMediaValue[]>> {
    const byRow = new Map<number, Record<string, StrapiMediaValue[]>>()
    if (!source.hasTable(StrapiMedia.Table)) return byRow

    const rows = source.rows<{
      related_id: number
      field: string
      url: string | null
      name: string | null
      mime: string | null
      width: number | null
      height: number | null
      size: number | null
      alternative_text: string | null
    }>(
      `SELECT j.related_id, j.field, f.url, f.name, f.mime, f.width, f.height, f.size,
              f.alternative_text
         FROM "${StrapiMedia.Table}" j
         JOIN files f ON f.id = j.file_id
        WHERE j.related_type = ? AND j.field IS NOT NULL
     ORDER BY j.related_id, j.field, j."order"`,
      owner,
    )

    for (const row of rows) {
      const fields = byRow.get(row.related_id) ?? {}
      const values = fields[row.field] ?? []
      values.push({
        url: StrapiMedia.absolute(row.url, baseUrl),
        name: row.name,
        mime: row.mime,
        width: row.width,
        height: row.height,
        // Strapi stores `size` in kilobytes as a float. Bytes is the unit every
        // other size in silo is in, so it is converted here rather than left as
        // a number whose unit only this table knows.
        size: row.size === null ? null : Math.round(row.size * 1024),
        alt: row.alternative_text,
      })
      fields[row.field] = values
      byRow.set(row.related_id, fields)
    }
    return byRow
  }

  /** The JSON Schema one media field gets. */
  static schemaFor(field: StrapiMediaField): Record<string, unknown> {
    const one = {
      type: ['object', 'null'],
      properties: {
        url: { type: 'string' },
        name: { type: ['string', 'null'] },
        mime: { type: ['string', 'null'] },
        width: { type: ['integer', 'null'] },
        height: { type: ['integer', 'null'] },
        size: { type: ['integer', 'null'] },
        alt: { type: ['string', 'null'] },
      },
      required: ['url'],
    }
    return field.multiple ? { type: 'array', items: one } : one
  }

  /**
   * `/uploads/x.svg` against `https://cms.example.com` → the absolute URL.
   *
   * An empty base leaves the path as Strapi wrote it, which is the right default
   * for an operator who has not told us where the files are: a relative
   * `/uploads/…` is at least a *true* statement about the source instance, where
   * a guessed host would be a false one.
   */
  private static absolute(url: string | null, baseUrl: string): string {
    if (!url) return ''
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) return url
    if (!baseUrl) return url
    return `${baseUrl.replace(/\/+$/, '')}/${url.replace(/^\/+/, '')}`
  }
}
