import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import path from 'path'
import { ImportPlans } from '../src/import/import-plan'
import { StrapiDatabase } from '../src/strapi/strapi-database'
import { StrapiInventory } from '../src/strapi/strapi-inventory'
import { StrapiDatabaseFixture } from './support/strapi-database-fixture'
import { TempDirectory } from './support/temp-directory'

describe('proposing a plan', () => {
  let tempDir: string
  let source: StrapiDatabase

  beforeEach(async () => {
    tempDir = await TempDirectory.make('strapi-plan-test')
    const file = path.join(tempDir, 'data.db')
    StrapiDatabaseFixture.write(file)
    source = StrapiDatabase.open(file)
  })

  afterEach(async () => {
    source.close()
    await TempDirectory.remove(tempDir)
  })

  const propose = (defaults: Partial<Parameters<typeof ImportPlans.propose>[1]> = {}) => {
    const inventory = StrapiInventory.read(source, 'published')
    return {
      inventory,
      plan: ImportPlans.propose(inventory, {
        scope: { project: 'default', env: 'prod' },
        prefix: '',
        mediaBaseUrl: '',
        mediaFolder: 'strapi',
        ...defaults,
      }),
    }
  }

  test('names the component whole, not the wrapper single type', () => {
    const { plan } = propose({ prefix: 'strapi_' })
    // `org-quicko-payment-entity` — the thing being imported — rather than the
    // single type Strapi wraps it in, and with its namespace kept: `bank` and
    // `payment_entity` are the names every other Strapi export also proposes.
    expect(plan.steps[0]!.collection).toBe('strapi_org-quicko-payment-entity')
    // `append`, because a plan that defaults to deleting is a plan somebody runs
    // once without reading.
    expect(plan.steps[0]!.mode).toBe('append')
  })

  /** The scope is silo's answer, not a configured one: `[plugins.config]` names
   *  no project or environment, so the only place a target can come from is the
   *  list of scopes that exist. */
  test('points at the scope it was handed, and carries it through a round trip', () => {
    const { inventory, plan } = propose({ scope: { project: 'staging', env: 'preview' } })
    expect(plan).toMatchObject({ project: 'staging', env: 'preview', mediaFolder: 'strapi' })

    const read = ImportPlans.read(plan, inventory)
    expect(read).toMatchObject({ project: 'staging', env: 'preview', mediaFolder: 'strapi' })
  })

  describe('what a plan may not say', () => {
    test('a list this source does not have, a duplicate target, a stale version', () => {
      const { inventory, plan } = propose()

      expect(() =>
        ImportPlans.read({ ...plan, steps: [{ ...plan.steps[0]!, list: 'api::gone.gone' }] }, inventory)
      ).toThrow(/names no list in this source/)

      expect(() =>
        ImportPlans.read({ ...plan, steps: [plan.steps[0]!, { ...plan.steps[0]! }] }, inventory)
      ).toThrow(/both write into/)

      // A plan built against one version cannot be run against the other: the
      // counts on it would be somebody else's.
      expect(() => ImportPlans.read({ ...plan, version: 'draft' }, inventory)).toThrow(
        /Re-read the source/
      )

      expect(() =>
        ImportPlans.read({ ...plan, steps: [{ ...plan.steps[0]!, collection: 'Not Valid' }] }, inventory)
      ).toThrow(/not a usable name/)

      // The hyphens the proposal now carries are silo's to accept, so the plan
      // that comes back unedited has to pass the same check.
      expect(plan.steps[0]!.collection).toContain('-')
      expect(ImportPlans.read(plan, inventory).steps[0]!.collection).toBe(plan.steps[0]!.collection)

      expect(() =>
        ImportPlans.read({ ...plan, steps: [{ ...plan.steps[0]!, include: false }] }, inventory)
      ).toThrow(/nothing to import/)
    })

    /**
     * A plan with no scope on it is refused by naming the two selects, not by
     * naming a string that failed a pattern.
     *
     * This is the shape an instance with no visible project produces, and it used
     * to be unreachable: the plan defaulted to `default`/`prod` from the config,
     * so an import silently went somewhere rather than saying it had nowhere to
     * go.
     */
    test('no project or environment chosen', () => {
      const { inventory, plan } = propose({ scope: { project: '', env: '' } })

      expect(() => ImportPlans.read(plan, inventory)).toThrow(/choose the project and environment/)
      expect(() => ImportPlans.read({ ...plan, project: 'default' }, inventory)).toThrow(
        /choose the project and environment/
      )
      expect(() =>
        ImportPlans.read({ ...plan, project: 'Not Valid', env: 'prod' }, inventory)
      ).toThrow(/not a usable name/)
    })

    test('a media folder that climbs out of the library', () => {
      const { inventory, plan } = propose()

      expect(() => ImportPlans.read({ ...plan, mediaFolder: 'a/../b' }, inventory)).toThrow(/".."/)
      // Silo normalises the slashes itself, so the plan only trims them.
      expect(ImportPlans.read({ ...plan, mediaFolder: '/strapi/' }, inventory).mediaFolder).toBe(
        'strapi'
      )
      // An operator who empties the field means the library root, and gets it.
      expect(ImportPlans.read({ ...plan, mediaFolder: '' }, inventory).mediaFolder).toBe('')
    })
  })
})
