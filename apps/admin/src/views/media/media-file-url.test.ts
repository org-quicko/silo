import { describe, expect, test } from 'bun:test'
import { MediaFileUrl } from './media-file-url'
import type { MediaAsset } from '../../api/types/media-asset'

/**
 * The admin's one way to turn a media reference into something an `<img>` can
 * load (D60).
 *
 * Worth its own tests because every way of getting it wrong fails the same
 * way — a broken image on a page whose job is to show the file — and because
 * three call sites had each written their own version. The joining case below
 * is the one that was actually shipped broken.
 */
describe('MediaFileUrl', () => {
  const server = 'http://localhost:8090'
  const asset = (url: string) => ({ url } as MediaAsset)

  describe('of', () => {
    test('roots a relative URL at the connected server', () => {
      expect(MediaFileUrl.of(asset('/media/01ABC'), server)).toBe('http://localhost:8090/media/01ABC')
    })

    /** The bug. `${server}${asset.url}` gave
     *  `http://localhost:8090https://api.example.com/media/01ABC`. */
    test('leaves an absolute URL alone instead of concatenating', () => {
      expect(MediaFileUrl.of(asset('https://api.example.com/media/01ABC'), server)).toBe(
        'https://api.example.com/media/01ABC',
      )
    })

    test('a bucket URL is absolute too, and equally untouched', () => {
      const bucket = 'https://silo-media.s3.ap-south-1.amazonaws.com/01ABC.png'
      expect(MediaFileUrl.of(asset(bucket), server)).toBe(bucket)
    })

    test('a trailing slash on the server URL does not double up', () => {
      expect(MediaFileUrl.of(asset('/media/01ABC'), 'http://localhost:8090/')).toBe(
        'http://localhost:8090/media/01ABC',
      )
    })
  })

  describe('forId', () => {
    /** Always silo's own route: it resolves even on an instance advertising
     *  bucket URLs, where this caller holds no blob key to build one with. */
    test('addresses the id on the connected server', () => {
      expect(MediaFileUrl.forId('01ABC', server)).toBe('http://localhost:8090/media/01ABC')
    })

    test('tolerates a trailing slash', () => {
      expect(MediaFileUrl.forId('01ABC', 'http://localhost:8090/')).toBe(
        'http://localhost:8090/media/01ABC',
      )
    })
  })

  describe('join', () => {
    test('an empty value is empty, not the bare server URL', () => {
      // An `<img src="http://localhost:8090">` would request the admin's own
      // HTML and render as broken, which is worse than rendering nothing.
      expect(MediaFileUrl.join('', server)).toBe('')
    })

    test('a value with no leading slash still gets one', () => {
      expect(MediaFileUrl.join('media/01ABC', server)).toBe('http://localhost:8090/media/01ABC')
    })
  })
})
