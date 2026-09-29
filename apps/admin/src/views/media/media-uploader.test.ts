import { describe, expect, test } from 'bun:test'
import { SiloError, ValidationFailedError } from '../../api/api-error'
import type { MediaUploadPlan } from './media-upload-plan'
import { MediaUploader, type MediaUploadTarget } from './media-uploader'

/** A target that records what it was asked, and fails the files it is told to. */
class RecordingTarget implements MediaUploadTarget {
  readonly uploads: string[] = []
  readonly folders: string[] = []
  private readonly failures: Map<string, Error>

  constructor(failures: Record<string, Error> = {}) {
    this.failures = new Map(Object.entries(failures))
  }

  async upload(file: File, folder: string) {
    const failure = this.failures.get(file.name)
    if (failure) throw failure
    this.uploads.push(`${folder}|${file.name}`)
  }

  async createFolder(path: string) {
    this.folders.push(path)
  }
}

const refusal = (message: string) => new ValidationFailedError(message, 'POST', '/api/media', [])

function planOf(...items: [folder: string, name: string][]): MediaUploadPlan {
  return { uploads: items.map(([folder, name]) => ({ file: new File(['x'], name), folder })), emptyFolders: [] }
}

describe('MediaUploader.run', () => {
  test('files a tree under the destination and leaves the folders to the server', async () => {
    const target = new RecordingTarget()
    const report = await MediaUploader.run(
      planOf(['', 'top.png'], ['photos', 'a.png'], ['photos/2024', 'b.png']),
      '/marketing',
      target,
    )
    expect(target.uploads).toEqual(['/marketing|top.png', '/marketing/photos|a.png', '/marketing/photos/2024|b.png'])
    expect(target.folders).toEqual([])
    expect(report).toEqual({ total: 3, uploaded: 3, refused: [], stopped: null })
  })

  test('from the root, a folder lands at the top level', async () => {
    const target = new RecordingTarget()
    await MediaUploader.run(planOf(['photos', 'a.png']), '', target)
    expect(target.uploads).toEqual(['/photos|a.png'])
  })

  test('makes each empty folder with a request of its own', async () => {
    const target = new RecordingTarget()
    const plan: MediaUploadPlan = { uploads: [], emptyFolders: ['site/empty', 'site/other/inner'] }
    const report = await MediaUploader.run(plan, '/docs', target)
    expect(target.folders).toEqual(['/docs/site/empty', '/docs/site/other/inner'])
    expect(report.stopped).toBeNull()
  })

  test('skips a refused file, keeps going, and says which and why', async () => {
    const target = new RecordingTarget({ 'bad.exe': refusal('".exe" files are not accepted.') })
    const report = await MediaUploader.run(
      planOf(['set', 'a.png'], ['set/inner', 'bad.exe'], ['set', 'b.png']),
      '',
      target,
    )
    expect(target.uploads).toEqual(['/set|a.png', '/set|b.png'])
    expect(report.uploaded).toBe(2)
    expect(report.refused).toEqual([{ path: 'set/inner/bad.exe', message: '".exe" files are not accepted.' }])
    expect(report.stopped).toBeNull()
  })

  test('treats a body over the limit as a refusal of that file', async () => {
    const tooLarge = new SiloError(413, 'unknown', 'payload too large', 'POST', '/api/media')
    const target = new RecordingTarget({ 'huge.mov': tooLarge })
    const report = await MediaUploader.run(planOf(['', 'huge.mov'], ['', 'small.png']), '', target)
    expect(report.refused.map((item) => item.path)).toEqual(['huge.mov'])
    expect(report.uploaded).toBe(1)
  })

  test('stops at a failure the next file would share, and does not make the empty folders', async () => {
    const busy = new SiloError(503, 'unknown', 'storage is busy', 'POST', '/api/media')
    const target = new RecordingTarget({ 'b.png': busy })
    const plan = { ...planOf(['', 'a.png'], ['', 'b.png'], ['', 'c.png']), emptyFolders: ['empty'] }
    const report = await MediaUploader.run(plan, '', target)
    expect(target.uploads).toEqual(['|a.png'])
    expect(target.folders).toEqual([])
    expect(report).toEqual({ total: 3, uploaded: 1, refused: [], stopped: 'storage is busy' })
  })

  test('reports progress after every file, refused or not', async () => {
    const target = new RecordingTarget({ 'b.png': refusal('no') })
    const seen: number[] = []
    await MediaUploader.run(planOf(['', 'a.png'], ['', 'b.png'], ['', 'c.png']), '', target, (handled) => {
      seen.push(handled)
    })
    expect(seen).toEqual([1, 2, 3])
  })
})
