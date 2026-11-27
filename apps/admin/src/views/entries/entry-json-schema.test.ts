import { describe, expect, test } from 'bun:test'
import { EntryJsonSchema } from './entry-json-schema'

describe('EntryJsonSchema.prepare', () => {
  test('closes structured objects with unevaluatedProperties while keeping any and free-form objects open', () => {
    const prepared = EntryJsonSchema.prepare('posts', {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      required: ['title'],
      properties: {
        title: { type: 'string' },
        data: {},
        meta: { type: ['object', 'null'] },
        explicitOpen: { type: 'object', properties: { a: { type: 'string' } }, additionalProperties: true },
        emptyClosed: { type: 'object', properties: {} },
      },
    })

    expect(prepared.dialect).toBe('2020-12')
    expect(prepared.strictRoot.unevaluatedProperties).toBe(false)

    const props = prepared.strictRoot.properties as Record<string, any>
    expect(props.data).toEqual({})
    expect(props.meta).toEqual({ type: ['object', 'null'] })
    expect(props.explicitOpen.unevaluatedProperties).toBeUndefined()
    expect(props.explicitOpen.additionalProperties).toBe(true)
    expect(props.emptyClosed.unevaluatedProperties).toBe(false)
  })

  test('closes composed use-sites while keeping $defs extensible and not closing contains', () => {
    const prepared = EntryJsonSchema.prepare('orders', {
      type: 'object',
      $defs: {
        Address: {
          type: 'object',
          properties: { city: { type: 'string' } },
        },
      },
      properties: {
        shipping: { $ref: '#/$defs/Address' },
        office: {
          allOf: [
            { $ref: '#/$defs/Address' },
            { type: 'object', properties: { suite: { type: 'string' } } },
          ],
        },
        tags: {
          type: 'array',
          contains: { type: 'object', properties: { featured: { type: 'boolean' } } },
        },
      },
    })

    const defs = prepared.strictRoot.$defs as Record<string, any>
    expect(defs.Address.unevaluatedProperties).toBeUndefined()

    const props = prepared.strictRoot.properties as Record<string, any>
    expect(props.shipping.unevaluatedProperties).toBe(false)
    expect(props.office.unevaluatedProperties).toBe(false)
    expect(props.office.allOf[1].unevaluatedProperties).toBeUndefined()
    expect(props.tags.contains.unevaluatedProperties).toBeUndefined()
  })

  test('extracts bundled silo:// refs, preserves cycles, and records unresolvable refs', () => {
    const prepared = EntryJsonSchema.prepare('nodes', {
      type: 'object',
      properties: {
        child: { $ref: 'silo://collections/nodes' },
        author: { $ref: 'silo://collections/authors' },
        remote: { $ref: 'https://example.com/ext.json', type: 'object' },
        missing: { $ref: 'silo://collections/ghost' },
      },
      $defs: {
        authors: {
          type: 'object',
          properties: { name: { type: 'string' } },
        },
      },
    })

    expect(prepared.originalBundled.has('authors')).toBe(true)
    expect(prepared.strictBundled.get('authors')?.unevaluatedProperties).toBeUndefined()
    expect(prepared.strictRoot.unevaluatedProperties).toBe(false)
    const props = prepared.strictRoot.properties as Record<string, any>
    expect(props.child.$ref).toBe('silo://collections/nodes')
    expect(props.author.$ref).toBe('silo://collections/authors')
    expect(props.author.unevaluatedProperties).toBe(false)
    expect(props.remote).toEqual({ type: 'object' })
    expect(props.missing).toEqual({})
    expect(prepared.uncheckedRefs).toEqual([
      'https://example.com/ext.json',
      'silo://collections/ghost',
    ])
  })

  test('falls back to draft-07 additionalProperties and flags unsupported dialects', () => {
    const draft7 = EntryJsonSchema.prepare('legacy', {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      properties: { title: { type: 'string' } },
    })
    expect(draft7.dialect).toBe('draft-07')
    expect(draft7.strictRoot.additionalProperties).toBe(false)
    expect(draft7.strictRoot.unevaluatedProperties).toBeUndefined()

    const draft4 = EntryJsonSchema.prepare('old', {
      $schema: 'http://json-schema.org/draft-04/schema#',
      type: 'object',
    })
    expect(draft4.dialect).toBe('unsupported')
  })

  test('preserves if/contains/not predicates, boolean branches, enum property names, and relative $id/$anchor refs', () => {
    const prepared = EntryJsonSchema.prepare('complex', {
      $id: 'https://example.org/root',
      type: 'object',
      $defs: {
        Named: {
          $anchor: 'ItemAnchor',
          type: 'object',
          properties: { label: { type: 'string' } },
        },
        Child: {
          $id: 'child',
          type: 'string',
        },
      },
      properties: {
        enum: { $ref: '#/$defs/Named' },
        anchored: { $ref: '#ItemAnchor' },
        rel: { $ref: 'child' },
        payload: { type: 'object' },
        list: {
          type: 'array',
          contains: { type: 'object', properties: { ok: { const: true } } },
        },
        either: {
          anyOf: [{ type: 'object', properties: { x: { type: 'string' } } }, true],
        },
        blockedNot: {
          not: { $ref: 'https://example.org/remote' },
        },
      },
      if: {
        properties: {
          payload: { type: 'object', properties: { ok: { const: true } } },
        },
      },
      then: { required: ['anchored'] },
    })

    const props = prepared.strictRoot.properties as Record<string, any>
    expect(props.enum.unevaluatedProperties).toBe(false)
    expect(props.anchored.unevaluatedProperties).toBe(false)
    expect(props.rel.$ref).toBe('child')
    expect(props.list.contains.unevaluatedProperties).toBeUndefined()
    expect(props.either.unevaluatedProperties).toBeUndefined()
    expect(props.blockedNot.not).toBeUndefined()
    expect((prepared.strictRoot.if as any).properties.payload.unevaluatedProperties).toBeUndefined()
    expect(prepared.uncheckedRefs).toEqual(['https://example.org/remote'])

    const draft7Pattern = EntryJsonSchema.prepare('d7', {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      patternProperties: { '^x-': { type: 'string' } },
    })
    expect(draft7Pattern.strictRoot.additionalProperties).toBe(false)
  })
})
