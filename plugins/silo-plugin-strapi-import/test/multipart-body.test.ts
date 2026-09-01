import { describe, test, expect } from 'bun:test'
import { MultipartBody } from '../src/silo/multipart-body'

/**
 * The multipart encoder.
 *
 * Asserted by **parsing it back with the platform's own parser** rather than by
 * comparing bytes to a fixture: what matters is that `POST /api/media` — which
 * reads `parseBody()` — sees a `file` field, and a byte-for-byte expectation
 * would pass while being unparseable.
 */
describe('encoding an upload as multipart', () => {
  const parse = (built: { contentType: string; bytes: Uint8Array }) =>
    new Request('http://silo.invalid/api/media', {
      method: 'POST',
      headers: { 'content-type': built.contentType },
      // Cast because this file is typechecked with both `lib.dom` and Bun's
      // types, and the two disagree about whether a `Uint8Array` is a `BodyInit`.
      body: built.bytes as unknown as BodyInit,
    }).formData()

  test('a file part and a field part both arrive as the server reads them', async () => {
    const bytes = new Uint8Array([0, 1, 2, 253, 254, 255])
    const form = await parse(
      MultipartBody.build([
        { name: 'file', filename: 'logo_a1b2.svg', contentType: 'image/svg+xml', value: bytes },
        { name: 'folder', value: 'strapi' },
      ]),
    )

    const file = form.get('file') as File
    expect(file).toBeInstanceOf(File)
    expect(file.name).toBe('logo_a1b2.svg')
    expect(file.type).toBe('image/svg+xml')
    // Binary, not text: an SVG survives either way, a PNG only survives this.
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes)
    expect(form.get('folder')).toBe('strapi')
  })

  test('a quote in a filename cannot end the header early', async () => {
    const form = await parse(
      MultipartBody.build([
        { name: 'file', filename: 'a"; name="folder', contentType: 'text/plain', value: 'x' },
      ]),
    )
    expect(form.get('folder')).toBeNull()
    expect(form.get('file')).toBeInstanceOf(File)
  })
})
