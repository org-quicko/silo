import { describe, expect, test } from 'bun:test'
import { MediaValue } from './media-value'

const TEST_ULID = '01ARZ3NDEKTSV4RRFFQ69G5FAV'

describe('MediaValue', () => {
  describe('idOf', () => {
    test('extracts canonical id from silo:// URI', () => {
      expect(MediaValue.idOf(`silo://media/${TEST_ULID}`)).toBe(TEST_ULID)
    })

    test('extracts canonical id from /media/<id> path with ULID', () => {
      expect(MediaValue.idOf(`/media/${TEST_ULID}`)).toBe(TEST_ULID)
    })

    test('returns null for undefined or empty string', () => {
      expect(MediaValue.idOf(undefined)).toBeNull()
      expect(MediaValue.idOf('')).toBeNull()
    })
  })

  describe('previewUrl', () => {
    test('resolves silo://media/<id> against baseUrl', () => {
      expect(MediaValue.previewUrl(`silo://media/${TEST_ULID}`, 'http://localhost:3000')).toBe(
        `http://localhost:3000/media/${TEST_ULID}`,
      )
    })

    test('resolves server-relative /media/<id> against baseUrl', () => {
      expect(MediaValue.previewUrl(`/media/${TEST_ULID}`, 'http://localhost:3000')).toBe(
        `http://localhost:3000/media/${TEST_ULID}`,
      )
    })

    test('preserves absolute URLs unchanged', () => {
      expect(MediaValue.previewUrl('https://cdn.example.com/image.png', 'http://localhost:3000')).toBe(
        'https://cdn.example.com/image.png',
      )
    })

    test('returns empty string for empty or undefined input', () => {
      expect(MediaValue.previewUrl(undefined, 'http://localhost:3000')).toBe('')
      expect(MediaValue.previewUrl('', 'http://localhost:3000')).toBe('')
    })
  })

  describe('looksLikeImage', () => {
    test('identifies media references and image extensions', () => {
      expect(MediaValue.looksLikeImage(`silo://media/${TEST_ULID}`)).toBeTrue()
      expect(MediaValue.looksLikeImage('/uploads/photo.jpg')).toBeTrue()
      expect(MediaValue.looksLikeImage('https://example.com/photo.webp')).toBeTrue()
      expect(MediaValue.looksLikeImage('/media/some-path')).toBeTrue()
      expect(MediaValue.looksLikeImage('/documents/report.pdf')).toBeFalse()
      expect(MediaValue.looksLikeImage(undefined)).toBeFalse()
    })
  })

  describe('displayName', () => {
    test('uses asset filename when asset is provided', () => {
      expect(
        MediaValue.displayName(`silo://media/${TEST_ULID}`, {
          id: TEST_ULID,
          filename: 'banner.png',
          folder: '',
          blob_key: 'key',
          content_type: 'image/png',
          size: 1024,
          hash: 'abc',
          state: 'active',
          tags: [],
          url: `/media/${TEST_ULID}`,
          created_at: '2026-08-27T00:00:00Z',
          updated_at: '2026-08-27T00:00:00Z',
        }),
      ).toBe('banner.png')
    })

    test('falls back to media ID if asset is null', () => {
      expect(MediaValue.displayName(`silo://media/${TEST_ULID}`, null)).toBe(TEST_ULID)
    })

    test('strips leading hash from raw path if asset is null', () => {
      expect(MediaValue.displayName('/uploads/0123456789abcdef0123456789abcdef_logo.svg', null)).toBe(
        'logo.svg',
      )
    })
  })

  describe('omitUnresolved', () => {
    const schema = {
      type: 'object',
      properties: {
        title: { type: 'string' },
        cover: { type: 'string', 'x-silo-type': 'media' },
        gallery: { type: 'array', items: { type: 'string', 'x-silo-type': 'media' } },
        author: {
          type: 'object',
          properties: {
            avatar: { type: 'string', 'x-silo-type': 'media' },
            name: { type: 'string' },
          },
        },
      },
    }

    test('a null media field is omitted, not sent as null', () => {
      const data = { title: 'hello', cover: null }
      expect(MediaValue.omitUnresolved(data, schema)).toEqual({ title: 'hello' })
    })

    test('a resolved media field is left alone', () => {
      const data = { title: 'hello', cover: `silo://media/${TEST_ULID}` }
      expect(MediaValue.omitUnresolved(data, schema)).toEqual(data)
    })

    test('a non-media field never touched, even if it happens to be null', () => {
      const data = { title: null, cover: `silo://media/${TEST_ULID}` }
      expect(MediaValue.omitUnresolved(data, schema)).toEqual(data)
    })

    test('null slots in a media array are filtered out, the array itself kept', () => {
      const data = { gallery: [`silo://media/${TEST_ULID}`, null, 'silo://media/other'] }
      expect(MediaValue.omitUnresolved(data, schema)).toEqual({
        gallery: [`silo://media/${TEST_ULID}`, 'silo://media/other'],
      })
    })

    test('recurses into a nested object schema', () => {
      const data = { author: { name: 'Jane', avatar: null } }
      expect(MediaValue.omitUnresolved(data, schema)).toEqual({ author: { name: 'Jane' } })
    })

    test('data with no matching schema property is left alone', () => {
      const data = { unknownField: null }
      expect(MediaValue.omitUnresolved(data, schema)).toEqual({ unknownField: null })
    })

    test('a non-object value passes through unchanged', () => {
      expect(MediaValue.omitUnresolved(null, schema)).toBeNull()
      expect(MediaValue.omitUnresolved('x', schema)).toBe('x')
    })
  })
})
