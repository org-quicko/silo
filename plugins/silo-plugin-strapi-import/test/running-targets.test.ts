import { describe, test, expect } from 'bun:test'
import type { ImportPlan } from '../src/import/import-plan'
import { RunningTargets } from '../src/import/running-targets'

/**
 * What two operators importing at once are still not allowed to do.
 *
 * Sessions made concurrent imports ordinary; two of them writing the same
 * collection is the one case that was never safe, since each would create it,
 * each read the existing count as zero, and each write every row.
 */
describe('the collections an import holds while it runs', () => {
  const plan = (project: string, env: string, ...collections: string[]): ImportPlan => ({
    project,
    env,
    version: 'published',
    mediaBaseUrl: '',
    mediaFolder: '',
    mediaLayout: 'single',
    steps: collections.map((collection) => ({
      list: `api::${collection}.${collection}`,
      collection,
      mode: 'append',
      include: true,
      flatten: false,
    })),
  })

  test('two imports of different collections both run', () => {
    const targets = new RunningTargets()
    targets.claim('job-1', plan('acme', 'prod', 'article'))
    expect(() => targets.claim('job-2', plan('acme', 'prod', 'author'))).not.toThrow()
  })

  test('the same collection in the same scope is refused, by name', () => {
    const targets = new RunningTargets()
    targets.claim('job-1', plan('acme', 'prod', 'article', 'author'))
    expect(() => targets.claim('job-2', plan('acme', 'prod', 'author'))).toThrow(
      /acme\/prod\/author.*job-1/s,
    )
  })

  test('the same name in another scope is a different collection', () => {
    const targets = new RunningTargets()
    targets.claim('job-1', plan('acme', 'prod', 'article'))
    expect(() => targets.claim('job-2', plan('acme', 'staging', 'article'))).not.toThrow()
  })

  test('releasing lets the next import have them', () => {
    const targets = new RunningTargets()
    const release = targets.claim('job-1', plan('acme', 'prod', 'article'))
    release()
    expect(() => targets.claim('job-2', plan('acme', 'prod', 'article'))).not.toThrow()
    // Releasing twice is a success: a job that failed to start releases, and so
    // does the run when it settles.
    expect(() => release()).not.toThrow()
  })

  test('a refused claim holds nothing', () => {
    const targets = new RunningTargets()
    targets.claim('job-1', plan('acme', 'prod', 'article'))
    expect(() => targets.claim('job-2', plan('acme', 'prod', 'author', 'article'))).toThrow()

    targets.release('job-1')
    expect(() => targets.claim('job-3', plan('acme', 'prod', 'author'))).not.toThrow()
  })

  test('only so many run at once', () => {
    const targets = new RunningTargets()
    for (let index = 0; index < RunningTargets.MaxRunning; index += 1) {
      targets.claim(`job-${index}`, plan('acme', 'prod', `list-${index}`))
    }
    expect(() => targets.claim('job-over', plan('acme', 'prod', 'another'))).toThrow(
      /already running/,
    )
  })
})
