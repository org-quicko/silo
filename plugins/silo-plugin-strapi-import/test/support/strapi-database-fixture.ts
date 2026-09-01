import { Database } from 'bun:sqlite'

/**
 * A minimal Strapi 5 database, built to carry the two traps that make this
 * importer non-trivial.
 *
 * Synthetic rather than a fixture file, because what is being pinned is not a
 * particular export — it is the *shape* Strapi produces, and a shape is clearer
 * as thirty lines of SQL than as a megabyte of binary nobody can read in a diff.
 *
 * Trap one: **two document versions**, draft and published, each owning its own
 * copy of the component rows. Trap two: a component table whose name is a
 * *pluralised* form of its uid that no prefix match reaches —
 * `org-quicko.payment-entity` → `components_org_quicko_payment_entities`.
 */
export class StrapiDatabaseFixture {
  /** The one component uid every test in this suite reads. */
  static readonly Component = 'org-quicko.payment-entity'
  /** The single type Strapi wraps that component list in. */
  static readonly ContentType = 'api::org-quicko-payment-entity.org-quicko-payment-entity'

  static write(file: string): void {
    const db = new Database(file, { create: true })

    db.run(`CREATE TABLE strapi_core_store_settings (id INTEGER PRIMARY KEY, key TEXT, value TEXT)`)
    db.run(`CREATE TABLE files (
      id INTEGER PRIMARY KEY, name TEXT, alternative_text TEXT, width INTEGER, height INTEGER,
      mime TEXT, size REAL, url TEXT)`)
    db.run(`CREATE TABLE files_related_mph (
      id INTEGER PRIMARY KEY, file_id INTEGER, related_id INTEGER, related_type TEXT,
      field TEXT, "order" REAL)`)

    // The content type: a single type with draft-and-publish, holding one
    // repeatable component list.
    db.run(`CREATE TABLE org_quicko_payment_entities (
      id INTEGER PRIMARY KEY, document_id TEXT, created_at DATETIME, updated_at DATETIME,
      published_at DATETIME, locale TEXT)`)
    db.run(`INSERT INTO org_quicko_payment_entities (id, document_id, published_at)
            VALUES (1, 'doc1', NULL), (2, 'doc1', 1751022409249)`)

    // The component's own table, named the way Strapi's pluraliser names it.
    db.run(`CREATE TABLE components_org_quicko_payment_entities (
      id INTEGER PRIMARY KEY AUTOINCREMENT, entity_name VARCHAR(255), entity_type VARCHAR(255))`)
    db.run(`CREATE TABLE org_quicko_payment_entities_cmps (
      id INTEGER PRIMARY KEY, entity_id INTEGER, cmp_id INTEGER, component_type TEXT,
      field TEXT, "order" REAL)`)

    // Two logical items, four component rows: the draft copy and the published
    // copy, exactly as Strapi 5 stores them.
    const names: [string, string][] = [
      ['Mastercard', 'card'],
      ['Visa', 'card'],
    ]
    let cmp = 0
    for (const entity of [1, 2]) {
      for (const [index, [name, kind]] of names.entries()) {
        cmp++
        db.run(`INSERT INTO components_org_quicko_payment_entities (id, entity_name, entity_type)
                VALUES (?, ?, ?)`, [cmp, name, kind])
        db.run(`INSERT INTO org_quicko_payment_entities_cmps
                  (entity_id, cmp_id, component_type, field, "order")
                VALUES (?, ?, ?, 'items', ?)`,
          [entity, cmp, StrapiDatabaseFixture.Component, index + 1])
      }
    }

    // One icon, on the published copy's second row (cmp 4).
    // The `url` carries Strapi's content hash and `name` does not, which is why
    // the importer keys on the basename of `url`: two `visa.svg` uploads share a
    // `name` and never share a `url`.
    db.run(`INSERT INTO files (id, name, mime, size, url, width, height)
            VALUES (1, 'visa.svg', 'image/svg+xml', 2.5, '/uploads/visa_0a2d4ecc.svg', 24, 24)`)
    // The same file on both component rows of the published copy: one asset, two
    // fields, which is the shape `MediaLibrary`'s cache exists for.
    db.run(`INSERT INTO files_related_mph (file_id, related_id, related_type, field, "order")
            VALUES (1, 4, ?, 'entity_icon', 1), (1, 3, ?, 'entity_icon', 1)`,
      [StrapiDatabaseFixture.Component, StrapiDatabaseFixture.Component])

    db.run(
      `INSERT INTO strapi_core_store_settings (key, value)
       VALUES ('strapi_content_types_schema', ?)`,
      [
        JSON.stringify({
          [StrapiDatabaseFixture.ContentType]: {
            kind: 'singleType',
            collectionName: 'org_quicko_payment_entities',
            info: { displayName: 'Payment entity' },
            options: { draftAndPublish: true },
            __schema__: {
              attributes: {
                items: {
                  type: 'component',
                  component: StrapiDatabaseFixture.Component,
                  repeatable: true,
                },
              },
            },
          },
          // Dropped: Strapi's own machinery, which silo has no concepts for.
          'plugin::upload.file': { kind: 'collectionType', collectionName: 'files' },
        }),
      ],
    )
    db.close(true)
  }
}
