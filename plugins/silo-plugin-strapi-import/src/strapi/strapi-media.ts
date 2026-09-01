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

/** One row of Strapi's `files` table, as far as an import needs it. */
export interface StrapiMediaFile {
  /** The name on disk — the basename of `url`, which is what Strapi wrote into
   *  `public/uploads` and therefore the key an operator's directory listing
   *  matches. */
  name: string
  /** Strapi's `url` column verbatim: `/uploads/…`, or an absolute URL when the
   *  instance used a storage provider. */
  url: string
  mime: string | null
  /** Bytes. Strapi records `size` in kilobytes as a float, so it is converted
   *  here rather than left as a number whose unit only that table knows. */
  bytes: number | null
}

/**
 * Strapi's media catalog, and the fields that point into it.
 *
 * **The bytes are not in the database, and that is a fact about the export rather
 * than a limit of this plugin.** A `strapi transfer` carries the `files` table —
 * names, MIME types, sizes and `/uploads/…` paths — while the uploads themselves
 * are files in the instance's `public/uploads` directory. So this file reads the
 * catalog, `UploadStore` holds whatever bytes the operator supplied for it, and
 * `MediaLibrary` is where the two meet and become a silo media reference.
 *
 * A media field's imported value is a **string**, because that is silo's media
 * type (`x-silo-type: "media"`, D23): either `silo://media/<id>` for a file silo
 * now holds, or an absolute URL for one it does not. Both are values silo resolves
 * — a foreign URL is somebody else's asset and is left alone — which is what lets
 * a supplied file and an unsupplied one land in the same field without the schema
 * changing shape.
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
  static filesOf(
    source: StrapiDatabase,
    owner: string,
  ): Map<number, Record<string, StrapiMediaFile[]>> {
    const byRow = new Map<number, Record<string, StrapiMediaFile[]>>()
    if (!source.hasTable(StrapiMedia.Table)) return byRow

    const rows = source.rows<StrapiMediaRow & { related_id: number; field: string }>(
      `SELECT j.related_id, j.field, f.url, f.name, f.mime, f.size
         FROM "${StrapiMedia.Table}" j
         JOIN files f ON f.id = j.file_id
        WHERE j.related_type = ? AND j.field IS NOT NULL
     ORDER BY j.related_id, j.field, j."order"`,
      owner,
    )

    for (const row of rows) {
      const fields = byRow.get(row.related_id) ?? {}
      const values = fields[row.field] ?? []
      values.push(StrapiMedia.file(row))
      fields[row.field] = values
      byRow.set(row.related_id, fields)
    }
    return byRow
  }

  /**
   * Every distinct file the given owners reference — the set an operator has to
   * supply for the import to hold silo's own media rather than links.
   *
   * Deduplicated by name, because one flag or logo is commonly attached to many
   * rows and the operator is being asked to send **files**, not references. The
   * same deduplication is what makes `MediaLibrary`'s cache correct: a file
   * uploaded once is one asset in the library however many entries point at it.
   *
   * Scoped to owners rather than the whole `files` table, so the number the panel
   * shows is the number this import needs. A catalog full of images belonging to
   * content types nothing could be read from is not a list of missing work.
   */
  static wantedBy(source: StrapiDatabase, owners: readonly string[]): StrapiMediaFile[] {
    if (!source.hasTable(StrapiMedia.Table) || owners.length === 0) return []

    const placeholders = owners.map(() => '?').join(', ')
    const rows = source.rows<StrapiMediaRow>(
      `SELECT DISTINCT f.url, f.name, f.mime, f.size
         FROM "${StrapiMedia.Table}" j
         JOIN files f ON f.id = j.file_id
        WHERE j.related_type IN (${placeholders}) AND j.field IS NOT NULL
     ORDER BY f.name`,
      ...owners,
    )

    const byName = new Map<string, StrapiMediaFile>()
    for (const row of rows) {
      const file = StrapiMedia.file(row)
      if (file.name.length > 0 && !byName.has(file.name)) byName.set(file.name, file)
    }
    return [...byName.values()]
  }

  /**
   * The JSON Schema one media field gets.
   *
   * `x-silo-type: "media"` on a **string**, which is silo's media type and not an
   * approximation of it. This used to emit an object mirroring Strapi's own media
   * shape — `{ url, name, mime, width, height, size, alt }` — and that was wrong
   * in a way worth naming: it imported, it validated, and every one of silo's own
   * media behaviours passed it by. The admin rendered a nested form instead of the
   * media picker, `MediaRefs.extract` found no reference so nothing counted as a
   * usage, and a read never rewrote the URL. Faithful to the source and inert in
   * the destination.
   *
   * Nullable on the single-file form, because a field with no file is `null` and
   * an absent key would read the same as a cleared one. The array form is not: a
   * row with no files is `[]`.
   */
  static schemaFor(field: StrapiMediaField): Record<string, unknown> {
    if (field.multiple) {
      return {
        type: 'array',
        items: { type: 'string', 'x-silo-type': 'media' },
        description: 'Imported from a Strapi media field holding more than one file.',
      }
    }
    return {
      type: ['string', 'null'],
      'x-silo-type': 'media',
      description: 'Imported from a Strapi media field.',
    }
  }

  /**
   * `/uploads/x.svg` against `https://cms.example.com` → the absolute URL.
   *
   * An empty base leaves the path as Strapi wrote it, which is the right default
   * for an operator who has not told us where the files are: a relative
   * `/uploads/…` is at least a *true* statement about the source instance, where
   * a guessed host would be a false one.
   */
  static absolute(url: string, baseUrl: string): string {
    if (!url) return ''
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) return url
    if (!baseUrl) return url
    return `${baseUrl.replace(/\/+$/, '')}/${url.replace(/^\/+/, '')}`
  }

  private static file(row: StrapiMediaRow): StrapiMediaFile {
    const url = row.url ?? ''
    return {
      name: StrapiMedia.basename(url) || (row.name ?? ''),
      url,
      mime: row.mime,
      bytes: row.size === null ? null : Math.round(row.size * 1024),
    }
  }

  /**
   * The filename in `url`.
   *
   * `url` and not the `name` column, because `name` is the name the file was
   * *uploaded* as and `url` is what Strapi wrote to disk — two `logo.svg` uploads
   * share a `name` and never share a `url`. The hash Strapi appends is the whole
   * reason the operator's directory listing can be matched by name at all.
   */
  private static basename(url: string): string {
    const path = url.split(/[?#]/)[0] ?? ''
    return path.split('/').pop() ?? ''
  }
}

/** The columns every read here selects. */
interface StrapiMediaRow {
  url: string | null
  name: string | null
  mime: string | null
  size: number | null
}
