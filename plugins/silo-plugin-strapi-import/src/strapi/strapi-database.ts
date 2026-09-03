import { Database } from 'bun:sqlite'
import type { StrapiColumn } from './strapi-columns'
import { StrapiIdentifiers } from './strapi-identifiers'

/** One `api::` content type, as `strapi_content_types_schema` records it. */
export interface StrapiContentType {
  uid: string
  kind: 'singleType' | 'collectionType'
  /** The table Strapi's schema names. Not always the one it stored — see
   *  `StrapiIdentifiers`. */
  collectionName: string
  /** The physical table, resolved against what the export actually holds, or
   *  `null` when nothing in it answers to that name. */
  table: string | null
  displayName: string
  draftAndPublish: boolean
  attributes: Record<string, StrapiAttribute>
}

/** A content type whose rows are in this database. Everything that reads rows
 *  takes this rather than re-checking the table it was handed. */
export type StrapiStoredType = StrapiContentType & { table: string }

export interface StrapiAttribute {
  type: string
  /** Component uid, on a `component` attribute. */
  component?: string
  repeatable?: boolean
  /** Whether a `media` attribute holds more than one file. */
  multiple?: boolean
  /** The component uids a `dynamiczone` attribute may hold. */
  components?: string[]
  /** The values an `enumeration` attribute declares. Carried as `unknown`
   *  because it comes out of a JSON document, and `StrapiEnums` is where it is
   *  checked. */
  enum?: unknown
}

/**
 * Read-only access to a Strapi 5 SQLite export (`strapi transfer`,
 * `strapi export`, or a copied `data.db`).
 *
 * Opened read-only, and that is not only hygiene: the file is a staged upload
 * this plugin does not own the provenance of, and a writable handle would let a
 * corrupt page trigger recovery that rewrites it. Nothing here interprets the
 * data — `StrapiInventory` does that — so this file is the whole of what silo
 * needs to know about Strapi's storage layout.
 */
export class StrapiDatabase {
  private readonly db: Database

  private constructor(db: Database) {
    this.db = db
  }

  /**
   * Open a file, or refuse with what is wrong with it.
   *
   * The tables are checked before anything else is read, because "this is not a
   * Strapi database" is the mistake an operator is most likely to make — a
   * `.tar.gz` from `strapi export`, or silo's own `silo.db` — and a missing-table
   * error from three layers down is not an answer they can act on.
   */
  static open(path: string): StrapiDatabase {
    let db: Database
    try {
      db = new Database(path, { readonly: true })
    } catch (caught: any) {
      throw new Error(`that file could not be opened as SQLite: ${caught?.message ?? caught}`)
    }

    const source = new StrapiDatabase(db)
    for (const table of ['strapi_core_store_settings', 'files']) {
      if (!source.hasTable(table)) {
        db.close()
        throw new Error(
          `that SQLite file has no "${table}" table, so it is not a Strapi database. ` +
            `A "strapi transfer" to a file gives you the .db this expects; "strapi export" ` +
            `gives a .tar.gz, which this cannot read.`,
        )
      }
    }
    return source
  }

  /**
   * Close, releasing the file.
   *
   * `close(true)` and not `close()`, and every read below uses `prepare` +
   * `finalize` rather than `query`, for one reason that only shows up on
   * Windows: `Database.query` **caches** the prepared statement by SQL text, a
   * live statement keeps the database handle open, and an open handle on Windows
   * makes the file undeletable. The symptom is nothing to do with SQLite — the
   * *second* upload of a session fails `EBUSY` trying to replace a staged file
   * this process is still holding.
   *
   * On POSIX none of this is visible, which is exactly why it is written down
   * here rather than left as a style preference.
   */
  close(): void {
    try {
      this.db.close(true)
    } catch {
      // Already closed, or a statement outlived its reader. Either way the
      // caller is done with this handle and has nothing to do about it.
      this.db.close(false)
    }
  }

  hasTable(name: string): boolean {
    return (
      this.one(`SELECT 1 FROM sqlite_master WHERE type IN ('table','view') AND name = ?`, name) !==
      null
    )
  }

  /**
   * The physical table `declared` is stored under, or `null`.
   *
   * Strapi shortens an identifier past 55 characters, so a `collectionName` and
   * the table holding its rows are two different strings for exactly the longest
   * names — see `StrapiIdentifiers`.
   */
  table(declared: string): string | null {
    for (const spelling of StrapiIdentifiers.spellings(declared)) {
      if (this.hasTable(spelling)) return spelling
    }
    return null
  }

  tables(prefix: string): string[] {
    return this.rows<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE ? ORDER BY name`,
      `${prefix}%`,
    ).map((row) => row.name)
  }

  count(table: string): number {
    return (this.one<{ n: number }>(`SELECT COUNT(*) AS n FROM "${table}"`)?.n ?? 0) as number
  }

  /** Every read goes through here, and every statement is finalized — see
   *  `close`. */
  rows<T = Record<string, unknown>>(sql: string, ...parameters: unknown[]): T[] {
    const statement = this.db.prepare(sql)
    try {
      return statement.all(...(parameters as any[])) as T[]
    } finally {
      statement.finalize()
    }
  }

  private one<T = Record<string, unknown>>(sql: string, ...parameters: unknown[]): T | null {
    const statement = this.db.prepare(sql)
    try {
      return (statement.get(...(parameters as any[])) as T | null) ?? null
    } finally {
      statement.finalize()
    }
  }

  /**
   * A column list for one table.
   *
   * `PRAGMA table_info` rather than `strapi_database_schema`, whose JSON is the
   * schema Strapi *intends* — the two disagree after a failed migration, and the
   * one that decides whether a `SELECT` works is this one. The Knex type names
   * `StrapiColumns` maps are recovered from the SQL declarations, which is where
   * the pragma's `type` comes from anyway.
   */
  columns(table: string): StrapiColumn[] {
    const info = this.rows<{ name: string; type: string }>(`PRAGMA table_info("${table}")`)
    return info.map((column) => ({
      name: column.name,
      type: StrapiDatabase.knexType(column.type),
    }))
  }

  /**
   * Every `api::` content type Strapi has recorded.
   *
   * `plugin::` and `admin::` are dropped: they are Strapi's own machinery —
   * users, roles, permissions, releases, workflows — and importing them into a
   * CMS that has none of those concepts would produce collections nothing reads.
   */
  contentTypes(): StrapiContentType[] {
    const row = this.one<{ value: string }>(
      `SELECT value FROM strapi_core_store_settings WHERE key = 'strapi_content_types_schema'`,
    )
    if (!row) return []

    let schema: Record<string, any>
    try {
      schema = JSON.parse(row.value)
    } catch (caught: any) {
      throw new Error(`the content-type schema in that database is not valid JSON: ${caught?.message}`)
    }

    const types: StrapiContentType[] = []
    for (const [uid, model] of Object.entries(schema)) {
      if (!uid.startsWith('api::')) continue
      types.push({
        uid,
        kind: model.kind === 'singleType' ? 'singleType' : 'collectionType',
        collectionName: model.collectionName,
        table: this.table(model.collectionName),
        displayName: model.info?.displayName ?? model.modelName ?? uid,
        draftAndPublish: model.options?.draftAndPublish === true,
        // `__schema__` is what the author declared; the sibling `attributes` adds
        // Strapi's own — timestamps, `createdBy`, `localizations`. The declared
        // set is what a mapping should be built from.
        attributes: model.__schema__?.attributes ?? model.attributes ?? {},
      })
    }
    return types
  }

  /** `varchar(255)` → `string`, `integer` → `integer`. SQLite keeps the
   *  declared type verbatim, and only the head of it carries the meaning. */
  private static knexType(declared: string): string {
    const head = declared.toLowerCase().split('(')[0]!.trim()
    if (head.startsWith('varchar') || head === 'text' || head === 'char') return 'string'
    if (head === 'json') return 'json'
    if (head === 'float' || head === 'real' || head === 'double') return 'float'
    if (head === 'decimal' || head === 'numeric') return 'decimal'
    if (head === 'boolean' || head === 'bool') return 'boolean'
    if (head === 'datetime' || head === 'timestamp' || head === 'date') return 'datetime'
    if (head === 'integer' || head === 'int' || head === 'bigint') return 'integer'
    return 'string'
  }
}
