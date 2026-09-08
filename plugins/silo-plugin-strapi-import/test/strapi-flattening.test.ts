import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import path from 'path'
import { StrapiDatabase } from '../src/strapi/strapi-database'
import { StrapiInventory } from '../src/strapi/strapi-inventory'
import { StrapiRows } from '../src/strapi/strapi-rows'
import { StrapiSchema } from '../src/strapi/strapi-schema'
import { StrapiDatabaseFixture } from './support/strapi-database-fixture'
import { TempDirectory } from './support/temp-directory'

/**
 * Flattening a single type that is nothing but a wrapper around one repeatable
 * component — one entry per item instead of one entry holding all of them.
 *
 * `ContentType` is exactly this shape: no columns, no media and no open field of
 * its own, one repeatable child, one component. `Page` (a dynamic zone) and
 * `LongType` (a plain collection type) are the negative cases — see
 * `README.md`, "Flattening a single type", for why the rule is this strict.
 */
describe('flattening a single type wrapping one repeatable component', () => {
  let tempDir: string
  let file: string

  beforeEach(async () => {
    tempDir = await TempDirectory.make('strapi-flattening-test')
    file = path.join(tempDir, 'data.db')
    StrapiDatabaseFixture.write(file)
  })

  afterEach(async () => {
    await TempDirectory.remove(tempDir)
  })

  const listOf = (
    source: StrapiDatabase,
    uid: string,
    version: 'published' | 'draft' = 'published',
  ) => StrapiInventory.read(source, version).lists.find((list) => list.id === uid)!

  test('the wrapper qualifies, in both versions, and the others do not', () => {
    const source = StrapiDatabase.open(file)
    try {
      for (const version of ['published', 'draft'] as const) {
        const list = listOf(source, StrapiDatabaseFixture.ContentType, version)
        expect(list.flatten).toEqual({
          field: 'items',
          component: StrapiDatabaseFixture.Component,
          count: 2,
        })
      }

      expect(listOf(source, StrapiDatabaseFixture.Page).flatten).toBeNull()
      expect(listOf(source, StrapiDatabaseFixture.LongType).flatten).toBeNull()
    } finally {
      source.close()
    }
  })

  test('reads one row per item, with the component nested inside it unchanged', () => {
    const source = StrapiDatabase.open(file)
    try {
      const list = listOf(source, StrapiDatabaseFixture.ContentType)
      const rows = StrapiRows.read(source, list, 'published', true)

      expect(rows).toHaveLength(2)
      expect(rows.map((row) => row.entry.entity_name)).toEqual(['Mastercard', 'Visa'])
      for (const row of rows) {
        expect((row.entry.rails as any[]).map((rail) => rail.rail_name)).toEqual(['NPCI', 'SWIFT'])
      }

      // Media paths are the component's own — no `items` index in front of
      // them, because each item is now its own top-level entry.
      const filled = (row: (typeof rows)[number]) =>
        row.media.filter((slot) => slot.files.length > 0).map((slot) => slot.path)
      expect(filled(rows[0]!)).toEqual([['entity_icon']])
      expect(filled(rows[1]!)).toEqual([['entity_icon'], ['rails', 0, 'rail_icon']])
      const railIcon = rows[1]!.media.find((slot) => slot.path.join('.') === 'rails.0.rail_icon')!
      expect(railIcon.files[0]).toMatchObject({ name: 'npci_1b3c5d.svg' })
    } finally {
      source.close()
    }
  })

  test('the schema is the component schema, not the wrapper schema', () => {
    const source = StrapiDatabase.open(file)
    try {
      const list = listOf(source, StrapiDatabaseFixture.ContentType)
      const schema = StrapiSchema.forList(list, true) as any

      expect(schema.properties.entity_name).toBeDefined()
      expect(schema.properties.items).toBeUndefined()
      expect(schema.description).toContain(StrapiDatabaseFixture.Component)
    } finally {
      source.close()
    }
  })

  test('flattening a list that does not qualify throws', () => {
    const source = StrapiDatabase.open(file)
    try {
      const page = listOf(source, StrapiDatabaseFixture.Page)
      expect(page.flatten).toBeNull()
      expect(() => StrapiRows.read(source, page, 'published', true)).toThrow(/cannot be flattened/)
      expect(() => StrapiSchema.forList(page, true)).toThrow(/cannot be flattened/)
    } finally {
      source.close()
    }
  })
})
