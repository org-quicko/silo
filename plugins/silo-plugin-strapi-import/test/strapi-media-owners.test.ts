import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import path from 'path'
import { StrapiDatabase } from '../src/strapi/strapi-database'
import { StrapiInventory } from '../src/strapi/strapi-inventory'
import { StrapiMediaOwners } from '../src/strapi/strapi-media-owners'
import { StrapiDatabaseFixture } from './support/strapi-database-fixture'
import { TempDirectory } from './support/temp-directory'

/**
 * Which collections of a run reference each upload — the exact ownership
 * `MediaFolders` needs for the `by-collection` layout, since one component uid
 * (or, here, one file) can serve two content types.
 *
 * `visa_0a2d4ecc.svg` is attached both to the payment entity's items and to the
 * template content type's one row — see `writeLongType` in the fixture — so it
 * is the case `shared` exists for. `npci_1b3c5d.svg` is only ever the payment
 * entity's, two levels down on a nested component.
 */
describe('which collections reference each upload', () => {
  let tempDir: string
  let file: string

  beforeEach(async () => {
    tempDir = await TempDirectory.make('strapi-media-owners-test')
    file = path.join(tempDir, 'data.db')
    StrapiDatabaseFixture.write(file)
  })

  afterEach(async () => {
    await TempDirectory.remove(tempDir)
  })

  const stepsFor = (source: StrapiDatabase, flatten = false) => {
    const inventory = StrapiInventory.read(source, 'published')
    const listOf = (uid: string) => inventory.lists.find((list) => list.id === uid)!
    return [
      { list: listOf(StrapiDatabaseFixture.ContentType), collection: 'payment-entity', flatten },
      { list: listOf(StrapiDatabaseFixture.LongType), collection: 'template', flatten: false },
      { list: listOf(StrapiDatabaseFixture.Page), collection: 'page', flatten: false },
    ]
  }

  test('a file two content types both attach is owned by both, and one only by its own', () => {
    const source = StrapiDatabase.open(file)
    try {
      const owners = StrapiMediaOwners.read(source, stepsFor(source), 'published')
      expect(owners.get('visa_0a2d4ecc.svg')).toEqual(new Set(['payment-entity', 'template']))
      expect(owners.get('npci_1b3c5d.svg')).toEqual(new Set(['payment-entity']))
    } finally {
      source.close()
    }
  })

  /** Flattening changes how the rows are shaped, not which files they hold —
   *  so ownership is the same either way. */
  test('flattening the owning step changes nothing about who owns the file', () => {
    const source = StrapiDatabase.open(file)
    try {
      const owners = StrapiMediaOwners.read(source, stepsFor(source, true), 'published')
      expect(owners.get('visa_0a2d4ecc.svg')).toEqual(new Set(['payment-entity', 'template']))
      expect(owners.get('npci_1b3c5d.svg')).toEqual(new Set(['payment-entity']))
    } finally {
      source.close()
    }
  })
})
