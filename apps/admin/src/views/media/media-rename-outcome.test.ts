import { describe, expect, test } from 'bun:test'
import { MediaRenameOutcome } from './media-rename-outcome'

/**
 * The decision `useMediaRenameFolderFlow` builds its rename-then-merge-offer
 * flow on: whether a `renameFolder` outcome ends the flow, and whether it
 * earns a merge offer.
 */
describe('MediaRenameOutcome', () => {
  test('ok closes the flow and offers no merge', () => {
    expect(MediaRenameOutcome.closes('ok')).toBe(true)
    expect(MediaRenameOutcome.mergeOffer('ok', '/a', '/b')).toBeNull()
  })

  test('conflict does not close the flow, and offers a merge naming from and to', () => {
    expect(MediaRenameOutcome.closes('conflict')).toBe(false)
    expect(MediaRenameOutcome.mergeOffer('conflict', '/a', '/b')).toEqual({ from: '/a', to: '/b' })
  })

  test('any other error does not close the flow and offers no merge — it already landed in the banner', () => {
    expect(MediaRenameOutcome.closes('error')).toBe(false)
    expect(MediaRenameOutcome.mergeOffer('error', '/a', '/b')).toBeNull()
  })
})
