import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import path from 'path'
import { ImportJob } from '../src/import/import-job'
import { ImportPlans } from '../src/import/import-plan'
import { StrapiDatabase } from '../src/strapi/strapi-database'
import { StrapiInventory } from '../src/strapi/strapi-inventory'
import { FakeSilo } from './support/fake-silo'
import { StrapiDatabaseFixture } from './support/strapi-database-fixture'
import { TempDirectory } from './support/temp-directory'

/**
 * One import, run.
 *
 * The thing pinned here is **where it goes**. Every write a job makes takes a
 * scope, and the scope is the plan's; when `[plugins.config]` also named one, a
 * retargeted plan and a configured target were two answers to the same question
 * and the panel silently restored the second.
 */
describe('running an import', () => {
  let tempDir: string
  let file: string

  beforeEach(async () => {
    tempDir = await TempDirectory.make('strapi-job-test')
    file = path.join(tempDir, 'data.db')
    StrapiDatabaseFixture.write(file)
  })

  afterEach(async () => {
    await TempDirectory.remove(tempDir)
  })

  /** A silo that has none of the collections asked for, and accepts everything. */
  function emptySilo() {
    const created: any[] = []
    const entries: { scope: any; collection: string; data: any }[] = []

    const { ctx, calls } = FakeSilo.context((path, init) => {
      if (path.endsWith('/schema')) return FakeSilo.answer(404, { error: { code: 'not_found' } })
      if (init?.method === 'POST') {
        created.push({ path, body: JSON.parse(String(init.body)) })
        return FakeSilo.answer(201, { name: 'ok' })
      }
      return FakeSilo.answer(200, { items: [] })
    })

    ctx.log = { debug() {}, info() {}, warn() {}, error() {} }
    ctx.entries = {
      list: async () => ({ data: [], total: 0, limit: 0, offset: 0 }),
      create: async (scope: any, collection: string, data: any) => {
        entries.push({ scope, collection, data })
        return data
      },
      delete: async () => {},
    }
    return { ctx, calls, created, entries }
  }

  function planFor(source: StrapiDatabase, scope: { project: string; env: string }) {
    const inventory = StrapiInventory.read(source, 'published')
    return {
      inventory,
      plan: ImportPlans.propose(inventory, {
        scope,
        prefix: '',
        mediaBaseUrl: 'https://cms.example.com',
        mediaFolder: 'strapi',
      }),
    }
  }

  test('creates the collection and writes every row in the scope the plan names', async () => {
    const source = StrapiDatabase.open(file)
    const { inventory, plan } = planFor(source, { project: 'staging', env: 'preview' })
    source.close()

    const silo = emptySilo()
    const job = new ImportJob({
      id: 'import-1',
      plan,
      sourcePath: file,
      inventory,
      // No uploads staged, so every media field keeps its Strapi URL and the
      // library is never called.
      uploads: FakeSilo.uploads(null),
      ctx: silo.ctx,
    })
    await job.run()

    const progress = job.snapshot()
    expect(progress.state).toBe('done')
    expect(progress.steps[0]).toMatchObject({ written: 2, failed: 0, state: 'done' })

    const scoped = '/api/projects/staging/environments/preview'
    // The existence check and the create both go to the plan's scope, and so does
    // every entry — not to a project named anywhere else.
    expect(silo.calls[0]!.path).toStartWith(`${scoped}/collections/`)
    expect(silo.created.map((call) => call.path)).toEqual([`${scoped}/collections`])
    expect(silo.created[0]!.body.name).toBe('org-quicko-payment-entity')
    expect(silo.entries.map((write) => write.scope)).toEqual([
      { project: 'staging', env: 'preview' },
      { project: 'staging', env: 'preview' },
    ])
    expect(silo.entries.map((write) => write.data.entity_name)).toEqual(['Mastercard', 'Visa'])
    // An unsupplied file is a link, and it is still a media value.
    expect(silo.entries[1]!.data.entity_icon).toBe(
      'https://cms.example.com/uploads/visa_0a2d4ecc.svg',
    )
  })

  /** Two runs of the same source into two scopes touch only their own. */
  test('the same plan retargeted writes somewhere else entirely', async () => {
    const source = StrapiDatabase.open(file)
    const { inventory, plan } = planFor(source, { project: 'default', env: 'prod' })
    source.close()

    const silo = emptySilo()
    await new ImportJob({
      id: 'import-2',
      plan: { ...plan, project: 'archive', env: 'cold' },
      sourcePath: file,
      inventory,
      uploads: FakeSilo.uploads(null),
      ctx: silo.ctx,
    }).run()

    expect(silo.entries.every((write) => write.scope.project === 'archive')).toBe(true)
    expect(silo.calls.some((call) => call.path.includes('/projects/default/'))).toBe(false)
  })
})
