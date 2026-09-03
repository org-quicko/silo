import { describe, expect, test } from 'bun:test'
import { SiloRefs } from './silo-refs'

const pointer = (name: string) => `#/$defs/${`silo:~1~1collections~1${name}`}`

describe('SiloRefs.resolveForForm', () => {
  // The whole point of D54: the server bundles what a schema references into
  // that schema's own `$defs`, so rendering one entry costs one schema.
  test('embeds a referenced collection from the document\'s own $defs', () => {
    const resolved = SiloRefs.resolveForForm('posts', {
      type: 'object',
      properties: { author: { $ref: 'silo://collections/authors' } },
      $defs: { authors: { type: 'object', properties: { name: { type: 'string' } } } },
    })

    expect(resolved.properties.author.$ref).toBe(pointer('authors'))
    expect(resolved.$defs['silo://collections/authors'].properties).toEqual({
      name: { type: 'string' },
    })
  })

  test('follows a reference through a second collection', () => {
    const resolved = SiloRefs.resolveForForm('posts', {
      type: 'object',
      properties: { author: { $ref: 'silo://collections/authors' } },
      $defs: {
        authors: {
          type: 'object',
          properties: { agency: { $ref: 'silo://collections/agencies' } },
        },
        agencies: { type: 'object', properties: { name: { type: 'string' } } },
      },
    })

    expect(resolved.$defs['silo://collections/authors'].properties.agency.$ref).toBe(
      pointer('agencies'),
    )
    expect(resolved.$defs['silo://collections/agencies']).toBeDefined()
  })

  // The server refuses a ref to a collection that does not exist, so this is
  // reachable only through a document written by hand or restored from an
  // archive. It renders as raw JSON rather than crashing the form.
  test('a reference nothing bundled becomes the raw-JSON marker', () => {
    const resolved = SiloRefs.resolveForForm('posts', {
      type: 'object',
      properties: { author: { $ref: 'silo://collections/authors' } },
    })

    expect(resolved.properties.author.$ref).toBeUndefined()
    expect(resolved.properties.author[SiloRefs.markerKey]).toBe('silo://collections/authors')
    expect(resolved.properties.author[SiloRefs.markerKindKey]).toBe('missing')
  })

  test('a cycle is broken rather than rendered forever', () => {
    const resolved = SiloRefs.resolveForForm('a', {
      type: 'object',
      properties: { b: { $ref: 'silo://collections/b' } },
      $defs: {
        a: { type: 'object', properties: { b: { $ref: 'silo://collections/b' } } },
        b: { type: 'object', properties: { a: { $ref: 'silo://collections/a' } } },
      },
    })

    expect(resolved.properties.b.$ref).toBe(pointer('b'))
    expect(resolved.$defs['silo://collections/b'].properties.a[SiloRefs.markerKindKey]).toBe(
      'cycle',
    )
  })

  test('a remote ref is a marker, since the client resolves nothing off-instance', () => {
    const resolved = SiloRefs.resolveForForm('posts', {
      type: 'object',
      properties: { meta: { $ref: 'https://example.com/meta.json' } },
    })

    expect(resolved.properties.meta[SiloRefs.markerKindKey]).toBe('remote')
  })

  // An author's own $defs are data, not a collection index: nothing looks one
  // up unless a `silo://collections/<name>` ref asks for that exact name.
  test('a hand-written $def is left alone', () => {
    const resolved = SiloRefs.resolveForForm('posts', {
      type: 'object',
      properties: { tag: { $ref: '#/$defs/Tag' } },
      $defs: { Tag: { type: 'string' } },
    })

    expect(resolved.properties.tag.$ref).toBe('#/$defs/Tag')
    expect(resolved.$defs.Tag).toEqual({ type: 'string' })
  })

  test('$schema is stripped, which the draft-07 ajv8 meta-schema would trip over', () => {
    const resolved = SiloRefs.resolveForForm('posts', {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
    })

    expect(resolved.$schema).toBeUndefined()
  })
})
