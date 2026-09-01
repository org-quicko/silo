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

  /**
   * **The rule this importer is correct or wrong by.**
   *
   * There are four rows in `components_…` and two items. Reading the component
   * table directly gives four, and the failure is silent: no error, no duplicate
   * id, just twice as much content. Both numbers are asserted — the count the
   * plan shows and the rows the import writes — because a version rule applied in
   * one place and not the other is the same bug wearing a correct-looking plan.
   */
  test('counts and reads one document version, not both copies', () => {
    const source = StrapiDatabase.open(file)
    try {
      expect(source.count('components_org_quicko_payment_entities')).toBe(4)

      for (const version of ['published', 'draft'] as const) {
        const inventory = StrapiInventory.read(source, version)
        expect(inventory.lists).toHaveLength(1)
        expect(inventory.lists[0]!.count).toBe(2)

        const rows = StrapiRows.read(source, inventory.lists[0]!, version)
        expect(rows).toHaveLength(2)
        expect(rows.map((row) => row.entry.entity_name)).toEqual(['Mastercard', 'Visa'])
      }
    } finally {
      source.close()
    }
  })

  /** `org-quicko.payment-entity` → `components_org_quicko_payment_entities`: the
   *  y→ies plural no prefix match reaches, and the case that made the first live
   *  run drop a content type with a misleading reason. */
  test('resolves a component table whose plural is not a prefix of its uid', () => {
    const source = StrapiDatabase.open(file)
    try {
      const inventory = StrapiInventory.read(source, 'published')
      expect(inventory.lists[0]!.table).toBe('components_org_quicko_payment_entities')
      expect(inventory.skipped).toEqual([])
    } finally {
      source.close()
    }
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
  test('a media field is x-silo-type media on a string, and carries no Strapi id', () => {
    const source = StrapiDatabase.open(file)
    try {
      const inventory = StrapiInventory.read(source, 'published')
      const list = inventory.lists[0]!
      expect(list.media.map((field) => field.name)).toEqual(['entity_icon'])

      const schema = StrapiSchema.forList(list) as any
      expect(schema.properties.entity_icon).toMatchObject({
        type: ['string', 'null'],
        'x-silo-type': 'media',
      })
      // Silo mints its own identity, so nothing of Strapi's is carried.
      expect(schema.properties.strapi_id).toBeUndefined()
      expect(schema.properties.document_id).toBeUndefined()
      expect(schema.properties.entity_name).toEqual({ type: ['string', 'null'] })
    } finally {
      source.close()
    }
  })

  test('media reaches the row as files keyed on the name Strapi wrote to disk', () => {
    const source = StrapiDatabase.open(file)
    try {
      const inventory = StrapiInventory.read(source, 'published')
      const list = inventory.lists[0]!
      const rows = StrapiRows.read(source, list, 'published')

      // The basename of `url`, hash and all — the string an operator's uploads
      // directory listing actually holds.
      expect(rows[1]!.media.entity_icon![0]).toMatchObject({
        name: 'visa_0a2d4ecc.svg',
        url: '/uploads/visa_0a2d4ecc.svg',
        mime: 'image/svg+xml',
        // Strapi records kilobytes; every other size in silo is bytes.
        bytes: 2560,
      })
      // The scalar half of the entry holds no media at all: filling a media field
      // means uploading bytes, and a database read has no business awaiting that.
      expect(rows[1]!.entry.entity_icon).toBeUndefined()
    } finally {
      source.close()
    }
  })

  /** One file on two fields is **one** thing to ask the operator for. */
  test('the wanted-file list is deduplicated and scoped to the lists found', () => {
    const source = StrapiDatabase.open(file)
    try {
      const inventory = StrapiInventory.read(source, 'published')
      const owners = StrapiInventory.ownersOf(inventory)
      expect(owners).toEqual([StrapiDatabaseFixture.Component])

      const wanted = StrapiMedia.wantedBy(source, owners)
      expect(wanted.map((file) => file.name)).toEqual(['visa_0a2d4ecc.svg'])
      // Nothing is wanted for an owner this import does not cover.
      expect(StrapiMedia.wantedBy(source, ['api::other.other'])).toEqual([])
    } finally {
      source.close()
    }
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
