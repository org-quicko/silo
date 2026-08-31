import { describe, expect, test } from 'bun:test'
import type { MediaAsset } from '../../api/types/media-asset'
import type { MediaBulkDeleteResult } from '../../api/types/media-bulk-delete'
import { MediaDeleteOutcome } from './media-delete-outcome'

const asset = (patch: Partial<MediaAsset> = {}): MediaAsset => ({
  id: 'a1',
  filename: 'a.png',
  folder: '',
  blob_key: 'a1.png',
  size: 10,
  content_type: 'image/png',
  hash: 'x',
  state: 'active',
  tags: [],
  url: '/media/a1',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  ...patch,
})

/**
 * The decision `MediaLibraryView` builds its two-dialog flow on: whether a
 * bulk delete result needs a second, "still in use" dialog at all, and how
 * to denormalize a `media_in_use` failure back against the asset it came
 * from.
 */
describe('MediaDeleteOutcome', () => {
  test('Case A: nothing in use needs no second dialog — an empty inUse is the signal', () => {
    const result: MediaBulkDeleteResult = { deleted: ['a1', 'a2'], failed: [] }
    expect(MediaDeleteOutcome.classify(result)).toEqual({ inUse: [], otherFailures: [] })
  })

  test('Case A still holds when the only failures are not_found or stalled', () => {
    const result: MediaBulkDeleteResult = {
      deleted: ['a1'],
      failed: [
        { id: 'a2', code: 'not_found', message: 'gone' },
        { id: 'a3', code: 'media_delete_stalled', message: 'stuck' },
      ],
    }
    const { inUse, otherFailures } = MediaDeleteOutcome.classify(result)
    expect(inUse).toEqual([])
    expect(otherFailures).toHaveLength(2)
  })

  test('Case B: a media_in_use failure needs the second dialog, and only that failure', () => {
    const result: MediaBulkDeleteResult = {
      deleted: ['a1'],
      failed: [
        {
          id: 'a2',
          code: 'media_in_use',
          message: 'in use',
          usage_count: 3,
          visible_count: 1,
          referrers: [{ media_id: 'a2', project: 'default', env: 'prod', collection: 'posts', entry_id: 'e1' }],
        },
        { id: 'a3', code: 'not_found', message: 'gone' },
      ],
    }
    const { inUse, otherFailures } = MediaDeleteOutcome.classify(result)
    expect(inUse).toHaveLength(1)
    expect(inUse[0].id).toBe('a2')
    expect(otherFailures).toEqual([{ id: 'a3', code: 'not_found', message: 'gone' }])
  })

  test('withFilenames denormalizes against the assets the confirm dialog held, and defaults missing fields', () => {
    const assets = [asset({ id: 'a1', filename: 'one.png' }), asset({ id: 'a2', filename: 'two.png' })]
    const failures = [
      { id: 'a2', code: 'media_in_use' as const, message: 'in use', usage_count: 2, visible_count: 2, referrers: [] },
    ]
    const [withName] = MediaDeleteOutcome.withFilenames(failures, assets)
    expect(withName.filename).toBe('two.png')
    expect(withName.usage_count).toBe(2)

    // A failure naming an id the caller does not have an asset for (should
    // not happen, but must not throw) falls back to the id itself.
    const [fallback] = MediaDeleteOutcome.withFilenames(
      [{ id: 'unknown', code: 'media_in_use' as const, message: 'x' }],
      assets,
    )
    expect(fallback.filename).toBe('unknown')
    expect(fallback.usage_count).toBe(0)
    expect(fallback.referrers).toEqual([])
  })
})
