import { Database } from 'bun:sqlite'

/**
 * A minimal Strapi 5 database, built to carry the traps that make this importer
 * non-trivial.
 *
 * Synthetic rather than a fixture file, because what is being pinned is not a
 * particular export — it is the *shape* Strapi produces, and a shape is clearer
 * as sixty lines of SQL than as a megabyte of binary nobody can read in a diff.
 *
 * 1. **Two document versions**, draft and published, each owning its own copy of
 *    every component row.
 * 2. A component table whose name is a *pluralised* form of its uid that no
 *    prefix match reaches — `org-quicko.payment-entity` →
 *    `components_org_quicko_payment_entities`.
 * 3. A **component inside a component**, with the media on the inner one. That
 *    is where most of a real export's attachments are, and it is invisible to
 *    anything that reads only the content type's own join table.
 * 4. A **dynamic zone**, whose two component types share one field.
 * 5. A `collectionName` **past 55 characters**, which Strapi stores under a
 *    shortened name its own schema does not contain. The shortened spelling here
 *    is a literal on purpose: computing it with the code under test would make
 *    the assertion agree with whatever that code did.
 */
export class StrapiDatabaseFixture {
  /** The component the single type's list is made of. */
  static readonly Component = 'org-quicko.payment-entity'
  /** The component nested inside it, which only the join table names. */
  static readonly Nested = 'org-quicko.rail'
  /** The single type Strapi wraps that component list in. */
  static readonly ContentType = 'api::org-quicko-payment-entity.org-quicko-payment-entity'
  /** A collection type holding a dynamic zone. */
  static readonly Page = 'api::org-quicko-page.org-quicko-page'
  /** A content type whose declared table name is too long to be a table name. */
  static readonly LongType = 'api::org-quicko-template.org-quicko-template'
  static readonly LongDeclared = 'org_quicko_payment_entity_settlement_and_rail_templates_and_more'
  static readonly LongStored = 'org_quicko_payment_entity_settlement_and_rail_temp109b9'

  static write(file: string): void {
    const db = new Database(file, { create: true })

    db.run(`CREATE TABLE strapi_core_store_settings (id INTEGER PRIMARY KEY, key TEXT, value TEXT)`)
    db.run(`CREATE TABLE files (
      id INTEGER PRIMARY KEY, name TEXT, alternative_text TEXT, width INTEGER, height INTEGER,
      mime TEXT, size REAL, url TEXT)`)
    db.run(`CREATE TABLE files_related_mph (
      id INTEGER PRIMARY KEY, file_id INTEGER, related_id INTEGER, related_type TEXT,
      field TEXT, "order" REAL)`)

    StrapiDatabaseFixture.writePaymentEntity(db)
    StrapiDatabaseFixture.writePage(db)
    StrapiDatabaseFixture.writeLongType(db)
    StrapiDatabaseFixture.writeSchema(db)

    db.close(true)
  }

  /** The single type, its repeatable component, and the component inside that. */
  private static writePaymentEntity(db: Database): void {
    db.run(`CREATE TABLE org_quicko_payment_entities (
      id INTEGER PRIMARY KEY, document_id TEXT, created_at DATETIME, updated_at DATETIME,
      published_at DATETIME, locale TEXT)`)
    db.run(`INSERT INTO org_quicko_payment_entities (id, document_id, published_at)
            VALUES (1, 'doc1', NULL), (2, 'doc1', 1751022409249)`)

    // Named the way Strapi's pluraliser names it, not the way its uid reads.
    db.run(`CREATE TABLE components_org_quicko_payment_entities (
      id INTEGER PRIMARY KEY AUTOINCREMENT, entity_name VARCHAR(255), entity_type VARCHAR(255))`)
    db.run(`CREATE TABLE org_quicko_payment_entities_cmps (
      id INTEGER PRIMARY KEY, entity_id INTEGER, cmp_id INTEGER, component_type TEXT,
      field TEXT, "order" REAL)`)

    // The nested component. Nothing in the export declares it: a component's own
    // schema is in the project's files, so this join table is the only statement
    // that `rails` exists at all.
    db.run(`CREATE TABLE components_org_quicko_rails (
      id INTEGER PRIMARY KEY, rail_name VARCHAR(255))`)
    db.run(`CREATE TABLE components_org_quicko_payment_entities_cmps (
      id INTEGER PRIMARY KEY, entity_id INTEGER, cmp_id INTEGER, component_type TEXT,
      field TEXT, "order" REAL)`)

    // Two logical items, four component rows: the draft copy and the published
    // copy, exactly as Strapi 5 stores them. Each carries its own copy of the
    // nested rows too, which is what makes reading a component table directly
    // wrong at every depth rather than only the first.
    const names: [string, string][] = [
      ['Mastercard', 'card'],
      ['Visa', 'card'],
    ]
    let component = 0
    let rail = 0
    for (const entity of [1, 2]) {
      for (const [index, [name, kind]] of names.entries()) {
        component++
        db.run(
          `INSERT INTO components_org_quicko_payment_entities (id, entity_name, entity_type)
           VALUES (?, ?, ?)`,
          [component, name, kind],
        )
        db.run(
          `INSERT INTO org_quicko_payment_entities_cmps
             (entity_id, cmp_id, component_type, field, "order")
           VALUES (?, ?, ?, 'items', ?)`,
          [entity, component, StrapiDatabaseFixture.Component, index + 1],
        )
        for (const network of ['NPCI', 'SWIFT']) {
          rail++
          db.run(`INSERT INTO components_org_quicko_rails (id, rail_name) VALUES (?, ?)`, [
            rail,
            network,
          ])
          db.run(
            `INSERT INTO components_org_quicko_payment_entities_cmps
               (entity_id, cmp_id, component_type, field, "order")
             VALUES (?, ?, ?, 'rails', ?)`,
            [component, rail, StrapiDatabaseFixture.Nested, network === 'NPCI' ? 1 : 2],
          )
        }
      }
    }

    // One icon, on the published copy's second item (component 4).
    // The `url` carries Strapi's content hash and `name` does not, which is why
    // the importer keys on the basename of `url`: two `visa.svg` uploads share a
    // `name` and never share a `url`.
    db.run(`INSERT INTO files (id, name, mime, size, url, width, height)
            VALUES (1, 'visa.svg', 'image/svg+xml', 2.5, '/uploads/visa_0a2d4ecc.svg', 24, 24)`)
    db.run(
      `INSERT INTO files_related_mph (file_id, related_id, related_type, field, "order")
       VALUES (1, 4, ?, 'entity_icon', 1), (1, 3, ?, 'entity_icon', 1)`,
      [StrapiDatabaseFixture.Component, StrapiDatabaseFixture.Component],
    )
    // And one on a *nested* row — the published copy's second item's first rail.
    db.run(`INSERT INTO files (id, name, mime, size, url)
            VALUES (2, 'npci.svg', 'image/svg+xml', 1.5, '/uploads/npci_1b3c5d.svg')`)
    db.run(
      `INSERT INTO files_related_mph (file_id, related_id, related_type, field, "order")
       VALUES (2, 7, ?, 'rail_icon', 1)`,
      [StrapiDatabaseFixture.Nested],
    )
  }

  /** A collection type whose one field is a dynamic zone. */
  private static writePage(db: Database): void {
    db.run(`CREATE TABLE org_quicko_pages (
      id INTEGER PRIMARY KEY, document_id TEXT, title VARCHAR(255), published_at DATETIME)`)
    db.run(`INSERT INTO org_quicko_pages (id, document_id, title, published_at)
            VALUES (1, 'page1', 'Rates', 1751022409249)`)

    db.run(`CREATE TABLE components_org_quicko_text_blocks (
      id INTEGER PRIMARY KEY, body TEXT)`)
    db.run(`CREATE TABLE components_org_quicko_image_blocks (
      id INTEGER PRIMARY KEY, caption VARCHAR(255))`)
    db.run(`CREATE TABLE org_quicko_pages_cmps (
      id INTEGER PRIMARY KEY, entity_id INTEGER, cmp_id INTEGER, component_type TEXT,
      field TEXT, "order" REAL)`)

    db.run(`INSERT INTO components_org_quicko_text_blocks (id, body) VALUES (1, 'Slab rates')`)
    db.run(`INSERT INTO components_org_quicko_image_blocks (id, caption) VALUES (1, 'A chart')`)
    db.run(`INSERT INTO org_quicko_pages_cmps (entity_id, cmp_id, component_type, field, "order")
            VALUES (1, 1, 'org-quicko.text-block', 'blocks', 1),
                   (1, 1, 'org-quicko.image-block', 'blocks', 2)`)
  }

  /** The content type Strapi could not give the table name its schema declares. */
  private static writeLongType(db: Database): void {
    db.run(`CREATE TABLE "${StrapiDatabaseFixture.LongStored}" (
      id INTEGER PRIMARY KEY, document_id TEXT, template_name VARCHAR(255),
      published_at DATETIME)`)
    db.run(
      `INSERT INTO "${StrapiDatabaseFixture.LongStored}" (id, document_id, template_name, published_at)
       VALUES (1, 'tpl1', 'Business and Profession', 1751022409249)`,
    )
  }

  private static writeSchema(db: Database): void {
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
          [StrapiDatabaseFixture.Page]: {
            kind: 'collectionType',
            collectionName: 'org_quicko_pages',
            info: { displayName: 'Page' },
            options: { draftAndPublish: true },
            __schema__: {
              attributes: {
                title: { type: 'string' },
                blocks: {
                  type: 'dynamiczone',
                  components: ['org-quicko.text-block', 'org-quicko.image-block'],
                },
              },
            },
          },
          [StrapiDatabaseFixture.LongType]: {
            kind: 'collectionType',
            collectionName: StrapiDatabaseFixture.LongDeclared,
            info: { displayName: 'Template' },
            options: { draftAndPublish: true },
            __schema__: { attributes: { template_name: { type: 'string' } } },
          },
          // Dropped: Strapi's own machinery, which silo has no concepts for.
          'plugin::upload.file': { kind: 'collectionType', collectionName: 'files' },
        }),
      ],
    )

    // What the content-manager records about a component: its field names, and
    // nothing about their types. `rail_icon` is in here and `rail_colour` is a
    // field nothing in this export ever filled.
    db.run(
      `INSERT INTO strapi_core_store_settings (key, value) VALUES (?, ?)`,
      [
        `plugin_content_manager_configuration_components::${StrapiDatabaseFixture.Nested}`,
        JSON.stringify({
          uid: StrapiDatabaseFixture.Nested,
          isComponent: true,
          metadatas: { id: {}, rail_name: {}, rail_icon: {}, rail_colour: {}, documentId: {} },
        }),
      ],
    )
  }
}
