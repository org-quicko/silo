import { describe, expect, test } from 'bun:test'
import { MediaLibraryError } from './media-library-error'
import type { MediaUploadReport } from './media-upload-report'

const report = (over: Partial<MediaUploadReport>): MediaUploadReport => ({
  total: 1,
  uploaded: 1,
  refused: [],
  stopped: null,
  ...over,
})

describe('MediaLibraryError upload messages', () => {
  test('a clean upload says nothing', () => {
    expect(MediaLibraryError.uploadMessage(report({ total: 40, uploaded: 40 }))).toBe('')
  })

  test('one file that fails says why and nothing more', () => {
    const refused = [{ path: 'a.exe', message: '".exe" files are not accepted.' }]
    expect(MediaLibraryError.uploadMessage(report({ uploaded: 0, refused }))).toBe('".exe" files are not accepted.')
  })

  test('a folder says how much went up, and the first thing refused', () => {
    const refused = [
      { path: 'set/a.exe', message: 'not accepted' },
      { path: 'set/b.exe', message: 'not accepted' },
    ]
    expect(MediaLibraryError.uploadMessage(report({ total: 12, uploaded: 10, refused }))).toBe(
      '10 uploaded, 2 refused. First: set/a.exe: not accepted',
    )
  })

  test('a run that stopped says where', () => {
    expect(MediaLibraryError.uploadMessage(report({ total: 40, uploaded: 12, stopped: 'network down' }))).toBe(
      'Upload stopped after 12 of 40 files: network down',
    )
    expect(MediaLibraryError.uploadMessage(report({ uploaded: 0, stopped: 'network down' }))).toBe('network down')
  })

  test('a refused plan says nothing was uploaded, then states the rule', () => {
    const message = MediaLibraryError.uploadRefusedMessage('invalid folder segment "_assets"')
    expect(message.startsWith('Nothing was uploaded: invalid folder segment "_assets". ')).toBe(true)
    expect(message).toContain('start with a letter or digit')
  })
})
