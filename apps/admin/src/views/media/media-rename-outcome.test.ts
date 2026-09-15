import { describe, expect, test } from 'bun:test'
import { MediaRenameOutcome } from './media-rename-outcome'

/**
 * The decision `useMediaRenameFolderFlow` builds its rename-then-merge-offer
 * flow on: whether a `renameFolder` outcome ends the flow, whether it earns a
 * merge offer, and what the dialog says when it is neither.
 */
describe('MediaRenameOutcome', () => {
  test('ok closes the flow, offers no merge and says nothing', () => {
    expect(MediaRenameOutcome.closes({ status: 'ok' })).toBe(true)
    expect(MediaRenameOutcome.mergeOffer({ status: 'ok' }, '/a', '/b')).toBeNull()
    expect(MediaRenameOutcome.message({ status: 'ok' })).toBe('')
  })

  test('conflict does not close the flow, and offers a merge naming from and to', () => {
    expect(MediaRenameOutcome.closes({ status: 'conflict' })).toBe(false)
    expect(MediaRenameOutcome.mergeOffer({ status: 'conflict' }, '/a', '/b')).toEqual({ from: '/a', to: '/b' })
  })

  test('a conflict says nothing: the merge offer is the answer, not a message', () => {
    expect(MediaRenameOutcome.message({ status: 'conflict' })).toBe('')
  })

  test('any other error does not close the flow, offers no merge, and carries its message', () => {
    const outcome = { status: 'error', message: 'Could not rename the folder' } as const
    expect(MediaRenameOutcome.closes(outcome)).toBe(false)
    expect(MediaRenameOutcome.mergeOffer(outcome, '/a', '/b')).toBeNull()
    expect(MediaRenameOutcome.message(outcome)).toBe('Could not rename the folder')
  })
})
