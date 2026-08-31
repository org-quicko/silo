import { describe, expect, test } from 'bun:test'
import { Claims } from '@silo/shared/claims'
import type { MediaInUseAsset } from './media-delete-outcome'
import { MediaForceAvailability } from './media-force-availability'

const inUseAsset = (patch: Partial<MediaInUseAsset> = {}): MediaInUseAsset => ({
  id: 'a1',
  filename: 'a.png',
  usage_count: 1,
  visible_count: 1,
  visible_capped: false,
  referrers: [{ media_id: 'a1', project: 'default', env: 'prod', collection: 'posts', entry_id: 'e1' }],
  ...patch,
})

/**
 * Mirrors `RouteAuth.requireForcedMediaDelete` (D49): the force checkbox
 * must not arm when the server would refuse it.
 */
describe('MediaForceAvailability', () => {
  test('available when every referrer scope is visible and the key holds entries:update there', () => {
    const claims = [Claims.collection('default', 'prod', 'posts', Claims.CollectionEntriesUpdate)]
    expect(MediaForceAvailability.unavailable([inUseAsset()], claims)).toBeNull()
  })

  test('unavailable when the key cannot see every referrer (visible_count < usage_count)', () => {
    const asset = inUseAsset({ usage_count: 2, visible_count: 1 })
    const claims = [Claims.collection('default', 'prod', 'posts', Claims.CollectionEntriesUpdate)]
    expect(MediaForceAvailability.unavailable([asset], claims)).not.toBeNull()
  })

  test('available with more referrers than one page holds, as long as every one is visible and readable (D49 fix)', () => {
    // 25 referrers, all in one scope this key holds entries:update in —
    // visible_count must be the true count (25), not a page size, or this
    // would be wrongly refused the way the pre-fix `items.length` bug did.
    const asset = inUseAsset({ usage_count: 25, visible_count: 25, visible_capped: false })
    const claims = [Claims.collection('default', 'prod', 'posts', Claims.CollectionEntriesUpdate)]
    expect(MediaForceAvailability.unavailable([asset], claims)).toBeNull()
  })

  test('unavailable when the server could not enumerate every referrer (visible_capped)', () => {
    // Even when visible_count happens to equal usage_count within the
    // capped window, capped must be checked on purpose rather than inferred
    // from the two counts disagreeing.
    const asset = inUseAsset({ usage_count: 2500, visible_count: 2000, visible_capped: true })
    const claims = [Claims.collection('default', 'prod', 'posts', Claims.CollectionEntriesUpdate)]
    const reason = MediaForceAvailability.unavailable([asset], claims)
    expect(reason).not.toBeNull()
    expect(reason).toContain('enumerate')
  })

  test('unavailable when the key lacks entries:update on a referring scope it can see', () => {
    const claims = [Claims.collection('default', 'prod', 'posts', Claims.CollectionEntriesRead)]
    const reason = MediaForceAvailability.unavailable([inUseAsset()], claims)
    expect(reason).not.toBeNull()
    expect(reason).toContain('entries:update')
  })

  test('root always satisfies it', () => {
    expect(MediaForceAvailability.unavailable([inUseAsset({ usage_count: 5, visible_count: 1 })], ['*'])).toBeNull()
  })

  test('checked across every asset in the batch — one missing scope makes the whole batch unavailable', () => {
    const ok = inUseAsset({ id: 'a1' })
    const missing = inUseAsset({
      id: 'a2',
      referrers: [{ media_id: 'a2', project: 'other', env: 'prod', collection: 'posts', entry_id: 'e2' }],
    })
    const claims = [Claims.collection('default', 'prod', 'posts', Claims.CollectionEntriesUpdate)]
    expect(MediaForceAvailability.unavailable([ok, missing], claims)).not.toBeNull()
  })

  test('no referrers and nothing hidden is trivially available', () => {
    const asset = inUseAsset({ usage_count: 0, visible_count: 0, referrers: [] })
    expect(MediaForceAvailability.unavailable([asset], [])).toBeNull()
  })
})
