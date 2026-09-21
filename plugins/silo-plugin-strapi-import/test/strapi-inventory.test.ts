import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import path from 'path'
import { StrapiDatabase } from '../src/strapi/strapi-database'
import { StrapiInventory } from '../src/strapi/strapi-inventory'
import { StrapiSchema } from '../src/strapi/strapi-schema'
import { StrapiMedia } from '../src/strapi/strapi-media'
import { StrapiRows } from '../src/strapi/strapi-rows'
import { StrapiDatabaseFixture } from './support/strapi-database-fixture'
import { TempDirectory } from './support/temp-directory'

describe('reading a Strapi export', () => {
  let tempDir: string
  let file: string

  beforeEach(async () => {
    tempDir = await TempDirectory.make('strapi-import-test')
    file = path.join(tempDir, 'data.db')
    StrapiDatabaseFixture.write(file)
  })

  afterEach(async () => {
    await TempDirectory.remove(tempDir)
  })

  const read = <T>(version: 'published' | 'draft', use: (source: StrapiDatabase) => T): T => {
    const source = StrapiDatabase.open(file)
    try {
      return use(source)
    } finally {
      source.close()
    }
  }

  const listOf = (source: StrapiDatabase, uid: string, version: 'published' | 'draft' = 'published') =>
    StrapiInventory.read(source, version).lists.find((list) => list.id === uid)!

  /**
   * **The rule this importer is correct or wrong by.**
   *
   * There are four rows in `components_…` and two items, and eight in the nested
   * table where there are four. Reading either table directly gives twice as
   * much, and the failure is silent: no error, no duplicate id, just twice as
   * much content. Both numbers are asserted — the count the plan shows and the
   * rows the import writes — because a version rule applied in one place and not
   * the other is the same bug wearing a correct-looking plan.
   */
  test('reads one document version at every depth, not both copies', () => {
    read('published', (source) => {
      expect(source.count('components_org_quicko_payment_entities')).toBe(4)
      expect(source.count('components_org_quicko_rails')).toBe(8)

      for (const version of ['published', 'draft'] as const) {
        const list = listOf(source, StrapiDatabaseFixture.ContentType, version)
        // A single type is one document, and the component list is inside it.
        expect(list.count).toBe(1)

        const rows = StrapiRows.read(source, list, version)
        expect(rows).toHaveLength(1)

        const items = rows[0]!.entry.items as any[]
        expect(items.map((item) => item.entity_name)).toEqual(['Mastercard', 'Visa'])
        for (const item of items) {
          expect(item.rails.map((rail: any) => rail.rail_name)).toEqual(['NPCI', 'SWIFT'])
        }
      }
    })
  })

  /**
   * **A single type is a collection with one entry, holding its components.**
   *
   * This importer used to lift a repeatable component into a collection of its
   * own, which turned a two-level model into one flat table and dropped the
   * level below it entirely. What is pinned here is the nesting: `rails` is a
   * component inside a component, and nothing in the export declares it — the
   * only statement that the field exists is the inner join table.
   */
  test('nests components inside the entry, at whatever depth the source has them', () => {
    read('published', (source) => {
      const list = listOf(source, StrapiDatabaseFixture.ContentType)
      expect(list.kind).toBe('singleType')
      expect(list.shape.children.map((child) => [child.field, child.kind])).toEqual([
        ['items', 'repeatable'],
      ])

      const items = list.shape.children[0]!.shapes[0]!
      expect(items.uid).toBe(StrapiDatabaseFixture.Component)
      // Inferred from the data, because a component's own schema is in the
      // project's files and never in the export.
      expect(items.children.map((child) => [child.field, child.kind])).toEqual([
        ['rails', 'repeatable'],
      ])
    })
  })

  /**
   * A dynamic zone's items each say which component they are, the way Strapi's
   * own API reports them — one field, two tables, one array.
   */
  test('a dynamic zone becomes one array whose items name their component', () => {
    read('published', (source) => {
      const list = listOf(source, StrapiDatabaseFixture.Page)
      const zone = list.shape.children.find((child) => child.field === 'blocks')!
      expect(zone.kind).toBe('zone')
      expect(zone.shapes.map((shape) => shape.uid).sort()).toEqual([
        'org-quicko.image-block',
        'org-quicko.text-block',
      ])

      const blocks = StrapiRows.read(source, list, 'published')[0]!.entry.blocks as any[]
      expect(blocks).toEqual([
        { __component: 'org-quicko.text-block', body: 'Slab rates' },
        { __component: 'org-quicko.image-block', caption: 'A chart' },
      ])
    })
  })

  /**
   * **An enumeration exists only in the declaration**, because Strapi stores one
   * as a plain `varchar` — so a column read on its own can never be more than a
   * string, and every imported enumeration arrived as free text.
   *
   * The declaration is not taken on trust either. Strapi enforces an enumeration
   * on write and never on the rows already stored, so a value dropped from a
   * content type stays in the table it was written to; carrying that declaration
   * would produce a schema silo refuses rows for that this export demonstrably
   * holds.
   */
  test('an enumeration the rows fit inside becomes an enum, and one they do not stays a string', () => {
    read('published', (source) => {
      const list = listOf(source, StrapiDatabaseFixture.Page)
      const schema = StrapiSchema.forList(list) as any

      // `null` is a member, not merely a permitted type: an unfilled
      // enumeration column is NULL, and `enum` without it refuses that row.
      expect(schema.properties.page_status).toEqual({
        type: ['string', 'null'],
        enum: ['draft', 'live', null],
      })
      expect(schema.properties.page_kind).toEqual({ type: ['string', 'null'] })

      const entries = StrapiRows.read(source, list, 'published').map((row) => row.entry)
      expect(entries.map((entry) => entry.page_status)).toEqual(['live', null])
    })
  })

  /**
   * **Strapi shortens a table name past 55 characters, and its schema keeps the
   * long one.** Asking whether `collectionName` is a table therefore reports a
   * content type as missing from an export holding every one of its rows — which
   * it did, for exactly the two longest names in a real instance.
   */
  test('finds a content type whose table name Strapi had to shorten', () => {
    read('published', (source) => {
      const inventory = StrapiInventory.read(source, 'published')
      expect(inventory.skipped.map((entry) => entry.contentType)).toEqual([
        StrapiDatabaseFixture.Expertise,
      ])

      const list = inventory.lists.find((entry) => entry.id === StrapiDatabaseFixture.LongType)!
      expect(list.table).toBe(StrapiDatabaseFixture.LongStored)
      expect(StrapiRows.read(source, list, 'published')[0]!.entry).toEqual({
        template_name: 'Business and Profession',
      })
    })
  })

  /** `org-quicko.payment-entity` → `components_org_quicko_payment_entities`: the
   *  y→ies plural no prefix match reaches, and the case that made the first live
   *  run drop a content type with a misleading reason. */
  test('resolves a component table whose plural is not a prefix of its uid', () => {
    read('published', (source) => {
      const list = listOf(source, StrapiDatabaseFixture.ContentType)
      expect(list.shape.children[0]!.shapes[0]!.table).toBe(
        'components_org_quicko_payment_entities',
      )
    })
  })

  /**
   * **A renamed category leaves a uid and a table with nothing in common.**
   *
   * Strapi writes a component's `collectionName` when the component is created
   * and never again, so renaming its category rewrites every reference to it and
   * none of its storage. `org-quicko-workspace.bench` is in
   * `components_seating_seats`, and no matcher over names — prefix, plural or
   * shortened — proposes that table at all.
   *
   * The entry is asserted and not only the table, because the failure this
   * covers was not an error. The list appeared on the plan, the import reported
   * one entry written, and the entry was `{ seats: [] }`: the panel's note about
   * an unresolved component was the only thing between an operator and content
   * that had quietly not arrived.
   */
  test('resolves a component table whose name shares nothing with its uid', () => {
    read('published', (source) => {
      const list = listOf(source, StrapiDatabaseFixture.Desk)
      expect(StrapiInventory.read(source, 'published').skipped.map((entry) => entry.contentType))
        .toEqual([StrapiDatabaseFixture.Expertise])
      expect(list.notes.join(' ')).not.toContain('No table could be proved')

      const child = list.shape.children[0]!
      expect(child.unresolved).toEqual([])
      expect(child.shapes[0]!.table).toBe(StrapiDatabaseFixture.RenamedTable)

      expect(StrapiRows.read(source, list, 'published')[0]!.entry).toEqual({
        floor: 'Ground',
        seats: [{ seat_label: 'Window' }, { seat_label: 'Aisle' }],
      })
    })
  })

  /**
   * The fields are load-bearing, and the ids are not enough on their own.
   *
   * `components_seating_seats` holds `cmp_id`s 1 and 2, and so do three other
   * component tables in this same database — a search proving a candidate only
   * by the rows it contains has four answers and picks one of them. Deleting the
   * component's content-manager record leaves the ids and takes the fields, and
   * what has to happen then is `null`: the panel says a component could not be
   * resolved, which is recoverable, where a wrong table would be an entry full of
   * somebody else's rows.
   */
  test('refuses to guess that table when the export does not name its fields', () => {
    const db = new Database(file)
    db.run(`DELETE FROM strapi_core_store_settings WHERE key LIKE ?`, [
      `%components::${StrapiDatabaseFixture.Renamed}`,
    ])
    db.close(true)

    read('published', (source) => {
      const child = listOf(source, StrapiDatabaseFixture.Desk).shape.children[0]!
      expect(child.shapes).toEqual([])
      expect(child.unresolved).toEqual([StrapiDatabaseFixture.Renamed])
    })
  })

  /**
   * **A content type whose every field is an unprovable component is skipped,
   * not offered.**
   *
   * `StrapiShapes.isEmpty` used to count any child at all, so a content type
   * with one attribute — a repeatable component no table could be proved for —
   * reached the plan as an importable list. On a real export it did: the plan
   * said one entry, the run reported one entry written, and the entry was
   * `{ expertise: [] }`. A note on the panel was the only thing that said
   * otherwise, and it sat next to a row that looked like every other row.
   *
   * So it is skipped, which is the same answer already given to a content type
   * with no importable fields at all — and it is *skipped*, not omitted: the
   * panel prints the list, and the reason names the component uid, because
   * finding that component's table is the thing that makes the content type
   * importable and nothing else is.
   */
  test('skips a content type whose only field is a component nothing proved a table for', () => {
    read('published', (source) => {
      const inventory = StrapiInventory.read(source, 'published')
      expect(inventory.lists.map((list) => list.id)).not.toContain(StrapiDatabaseFixture.Expertise)

      const skipped = inventory.skipped.find(
        (entry) => entry.contentType === StrapiDatabaseFixture.Expertise,
      )!
      // The uid, because it is what an operator goes looking for, and the count,
      // because skipping is what takes it off the plan.
      expect(skipped.reason).toContain(StrapiDatabaseFixture.Unprovable)
      expect(skipped.reason).toContain('1 empty entry')
    })
  })

  /**
   * The same content type with one scalar beside that component stays on the
   * plan, and the note is what carries the warning.
   *
   * The line between the two is "would this import write anything", and a
   * column is anything. Skipping this one would be the failure the design note
   * on `StrapiInventory.skipped` is about — a content type gone from the plan
   * whose rows were there to be had.
   */
  test('keeps a content type that has a scalar beside the unprovable component', () => {
    const db = new Database(file)
    db.run(`ALTER TABLE org_quicko_expertises ADD COLUMN headline VARCHAR(255)`)
    db.run(`UPDATE org_quicko_expertises SET headline = 'Direct tax'`)
    const key = 'strapi_content_types_schema'
    const row = db.query(`SELECT value FROM strapi_core_store_settings WHERE key = ?`).get(key) as {
      value: string
    }
    const schema = JSON.parse(row.value)
    schema[StrapiDatabaseFixture.Expertise].__schema__.attributes.headline = { type: 'string' }
    db.run(`UPDATE strapi_core_store_settings SET value = ? WHERE key = ?`, [
      JSON.stringify(schema),
      key,
    ])
    db.close(true)

    read('published', (source) => {
      const inventory = StrapiInventory.read(source, 'published')
      expect(inventory.skipped).toEqual([])

      const list = inventory.lists.find((entry) => entry.id === StrapiDatabaseFixture.Expertise)!
      expect(list.notes.join(' ')).toContain(
        `No table could be proved for ${StrapiDatabaseFixture.Unprovable}`,
      )
      expect(StrapiRows.read(source, list, 'published')[0]!.entry).toEqual({
        headline: 'Direct tax',
        expertise: [],
      })
    })
  })

  /**
   * **The schema is silo's media type, not a copy of Strapi's.**
   *
   * The importer used to emit an object mirroring Strapi's media shape, and every
   * one of silo's media behaviours passed it by: the admin rendered a nested form
   * instead of the picker, `MediaRefs.extract` found no reference so nothing
   * counted as a usage, and a read never rewrote the URL. Faithful to the source
   * and inert in the destination — which is why the keyword is asserted here
   * rather than left to the one live run that would have shown it.
   */
  test('a media field is x-silo-type media on a string, at every depth', () => {
    read('published', (source) => {
      const list = listOf(source, StrapiDatabaseFixture.ContentType)
      expect(list.mediaFields).toBe(2)

      const schema = StrapiSchema.forList(list) as any
      const item = schema.properties.items.items
      expect(item.properties.entity_icon).toMatchObject({
        type: ['string', 'null'],
        'x-silo-type': 'media',
      })
      expect(item.properties.rails.items.properties.rail_icon).toMatchObject({
        type: ['string', 'null'],
        'x-silo-type': 'media',
      })
      // Silo mints its own identity, so nothing of Strapi's is carried.
      expect(schema.properties.strapi_id).toBeUndefined()
      expect(schema.properties.document_id).toBeUndefined()
      expect(item.properties.entity_name).toEqual({ type: ['string', 'null'] })
    })
  })

  /**
   * A field the content-manager records and the data never filled: kept as an
   * untyped property rather than dropped, because a field an operator can see in
   * Strapi and not in silo reads as data loss.
   */
  test('a declared field this export never filled stays on the collection, untyped', () => {
    read('published', (source) => {
      const list = listOf(source, StrapiDatabaseFixture.ContentType)
      const rails = list.shape.children[0]!.shapes[0]!.children[0]!.shapes[0]!
      expect(rails.emptyFields).toEqual(['rail_colour'])

      const schema = StrapiSchema.forList(list) as any
      const rail = schema.properties.items.items.properties.rails.items
      expect(rail.properties.rail_colour).toEqual({
        description: 'Declared in Strapi and empty in this export, so its type could not be read.',
      })
    })
  })

  /**
   * **The path is the whole of what the writer needs.** Most of a real export's
   * media is on a nested component — one instance had 1646 attachments two
   * levels below the content type that owns them — so a slot carries where it
   * goes rather than a field name the writer would have to relate to a shape.
   */
  test('media reaches the row as a path into the nested entry', () => {
    read('published', (source) => {
      const list = listOf(source, StrapiDatabaseFixture.ContentType)
      const row = StrapiRows.read(source, list, 'published')[0]!

      const filled = row.media.filter((slot) => slot.files.length > 0)
      expect(filled.map((slot) => slot.path)).toEqual([
        ['items', 0, 'entity_icon'],
        ['items', 1, 'entity_icon'],
        ['items', 1, 'rails', 0, 'rail_icon'],
      ])
      // The basename of `url`, hash and all — the string an operator's uploads
      // directory listing actually holds.
      expect(filled[1]!.files[0]).toMatchObject({
        name: 'visa_0a2d4ecc.svg',
        url: '/uploads/visa_0a2d4ecc.svg',
        mime: 'image/svg+xml',
        // Strapi records kilobytes; every other size in silo is bytes.
        bytes: 2560,
      })
      // The scalar half of the entry holds no media at all: filling a media field
      // means uploading bytes, and a database read has no business awaiting that.
      expect((row.entry.items as any[])[1].entity_icon).toBeUndefined()
    })
  })

  /**
   * One file on two fields is **one** thing to ask the operator for — and the
   * nested component's file is asked for at all, which it was not while a
   * component two levels down was never reached.
   *
   * `seat_9f1e2a.svg` is in the list for the same reason one step further out: a
   * component whose table could not be resolved is an owner nothing is scoped
   * to, so its attachments were not asked for either.
   */
  test('the wanted-file list is deduplicated and covers nested components', () => {
    read('published', (source) => {
      const inventory = StrapiInventory.read(source, 'published')
      const owners = StrapiInventory.ownersOf(inventory)
      expect(owners).toContain(StrapiDatabaseFixture.Component)
      expect(owners).toContain(StrapiDatabaseFixture.Nested)
      expect(owners).toContain(StrapiDatabaseFixture.Renamed)

      const wanted = StrapiMedia.wantedBy(source, owners)
      expect(wanted.map((entry) => entry.name).sort()).toEqual([
        'npci_1b3c5d.svg',
        'seat_9f1e2a.svg',
        'visa_0a2d4ecc.svg',
      ])
      // Nothing is wanted for an owner this import does not cover.
      expect(StrapiMedia.wantedBy(source, ['api::other.other'])).toEqual([])
    })
  })

  test('refuses a file that is not a Strapi database, saying which', () => {
    const other = path.join(tempDir, 'not-strapi.db')
    const db = new Database(other, { create: true })
    db.run('CREATE TABLE things (id INTEGER PRIMARY KEY)')
    db.close(true)

    expect(() => StrapiDatabase.open(other)).toThrow(/not a Strapi database/)
    expect(() => StrapiDatabase.open(path.join(tempDir, 'nope.db'))).toThrow(/could not be opened/)
  })
})
