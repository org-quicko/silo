import { describe, expect, test } from 'bun:test'
import { EntryJsonValidator } from './entry-json-validator'

describe('EntryJsonValidator', () => {
  test('rejects unknown top-level keys while allowing arbitrary nested keys inside any/free-form fields', () => {
    const validator = new EntryJsonValidator('test', {
      type: 'object',
      required: ['title'],
      properties: {
        title: { type: 'string' },
        data: {},
        meta: { type: 'object' },
      },
    })

    const withUnknown = validator.validate(
      JSON.stringify(
        {
          title: 't',
          new: 'data',
          data: { user: { name: 'Alice', age: 30, address: { street: '123 Main St', city: 'Anytown' } } },
          meta: { nested: [1, 2, { deep: true }] },
        },
        null,
        2,
      ),
    )

    expect(withUnknown.ok).toBe(false)
    expect(withUnknown.kind).toBe('schema')
    expect(withUnknown.hasUnknownProperties).toBe(true)
    expect(withUnknown.diagnostics).toHaveLength(1)
    expect(withUnknown.diagnostics[0].message).toContain('"new"')
    expect(withUnknown.diagnostics[0].line).toBe(3)

    const valid = validator.validate(
      JSON.stringify(
        {
          title: 't',
          data: { user: { name: 'Alice', age: 30, address: { street: '123 Main St', city: 'Anytown' } } },
          meta: { custom: true },
        },
        null,
        2,
      ),
    )
    expect(valid.ok).toBe(true)
    expect(valid.kind).toBe('valid')
    expect(valid.diagnostics).toEqual([])
  })

  test('enforces empty properties: {} as closed while omitted properties stays open', () => {
    const validator = new EntryJsonValidator('items', {
      type: 'object',
      properties: {
        emptyObj: { type: 'object', properties: {} },
        openObj: { type: 'object' },
      },
    })

    expect(validator.validate('{"emptyObj": {}, "openObj": {"anything": 1}}').ok).toBe(true)

    const bad = validator.validate('{"emptyObj": {"typo": 1}}')
    expect(bad.ok).toBe(false)
    expect(bad.hasUnknownProperties).toBe(true)
    expect(bad.diagnostics[0].message).toContain('"typo"')
  })

  test('enforces patternProperties and respects explicit additionalProperties', () => {
    const validator = new EntryJsonValidator('headers', {
      type: 'object',
      properties: {
        env: {
          type: 'object',
          patternProperties: { '^x-': { type: 'string' } },
        },
        bag: {
          type: 'object',
          properties: { known: { type: 'number' } },
          additionalProperties: true,
        },
      },
    })

    expect(validator.validate('{"env": {"x-token": "abc"}, "bag": {"known": 1, "extra": "ok"}}').ok).toBe(
      true,
    )

    const badPattern = validator.validate('{"env": {"typo": "abc"}}')
    expect(badPattern.ok).toBe(false)
    expect(badPattern.hasUnknownProperties).toBe(true)
  })

  test('handles allOf, anyOf, oneOf, and reusable $defs without false positives or false negatives', () => {
    const validator = new EntryJsonValidator('records', {
      type: 'object',
      $defs: {
        Address: {
          type: 'object',
          properties: { city: { type: 'string' } },
        },
      },
      properties: {
        combined: {
          allOf: [
            { type: 'object', properties: { a: { type: 'number' } } },
            { type: 'object', properties: { b: { type: 'number' } } },
          ],
        },
        either: {
          anyOf: [
            { type: 'object', properties: { a: { type: 'number' } } },
            { type: 'object', properties: { b: { type: 'number' } } },
          ],
        },
        exclusive: {
          oneOf: [
            { type: 'object', properties: { a: { type: 'number' } } },
            { type: 'object', properties: { b: { type: 'number' } } },
          ],
        },
        shipping: { $ref: '#/$defs/Address' },
        office: {
          allOf: [
            { $ref: '#/$defs/Address' },
            { type: 'object', properties: { suite: { type: 'string' } } },
          ],
        },
      },
    })

    expect(
      validator.validate(
        JSON.stringify({
          combined: { a: 1, b: 2 },
          either: { a: 1, b: 2 },
          shipping: { city: 'NYC' },
          office: { city: 'SF', suite: '4B' },
        }),
      ).ok,
    ).toBe(true)

    expect(validator.validate('{"combined": {"a": 1, "b": 2, "typo": 3}}').hasUnknownProperties).toBe(true)
    expect(validator.validate('{"either": {"a": 1, "b": 2, "typo": 3}}').hasUnknownProperties).toBe(true)
    // `{ a: 1 }` matches BOTH branches of `oneOf` in the original schema (b is optional) -> must fail!
    expect(validator.validate('{"exclusive": {"a": 1}}').ok).toBe(false)
    expect(validator.validate('{"shipping": {"city": "NYC", "extra": 1}}').hasUnknownProperties).toBe(true)
    expect(validator.validate('{"office": {"city": "SF", "suite": "4B", "extra": 1}}').hasUnknownProperties).toBe(
      true,
    )
  })

  test('enforces draft 2020-12 prefixItems and dependentSchemas plus bundled silo:// refs', () => {
    const validator = new EntryJsonValidator('posts', {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        coords: {
          type: 'array',
          prefixItems: [{ type: 'number' }, { type: 'number' }],
        },
        card: { type: 'string' },
        billing: { type: 'string' },
        author: { $ref: 'silo://collections/authors' },
      },
      dependentSchemas: {
        card: { required: ['billing'] },
      },
      $defs: {
        authors: {
          type: 'object',
          required: ['name'],
          properties: { name: { type: 'string' } },
        },
      },
    })

    expect(validator.validate('{"coords": [10, "bad"]}').ok).toBe(false)
    expect(validator.validate('{"card": "visa"}').ok).toBe(false)
    expect(validator.validate('{"author": {"name": "Ada", "extra": 1}}').hasUnknownProperties).toBe(true)
    expect(
      validator.validate('{"coords": [10, 20], "card": "visa", "billing": "NYC", "author": {"name": "Ada"}}').ok,
    ).toBe(true)
  })

  test('preserves ownProperties and __proto__ safety and reports exact reserved key positions', () => {
    const validator = new EntryJsonValidator('proto', {
      type: 'object',
      required: ['constructor'],
      properties: {
        constructor: { type: 'string' },
        author: { type: 'object', properties: { id: { type: 'string' } } },
      },
    })

    const missingCtor = validator.validate('{}')
    expect(missingCtor.ok).toBe(false)
    expect(missingCtor.error).toContain('constructor')

    const protoKey = validator.validate('{"constructor":"ok","__proto__":{"admin":true}}')
    expect(protoKey.ok).toBe(false)
    expect(protoKey.hasUnknownProperties).toBe(true)

    const reservedUnicode = validator.validate('{\n  "author": { "id": "ok" },\n  "\\u0069d": "bad"\n}')
    expect(reservedUnicode.ok).toBe(false)
    expect(reservedUnicode.kind).toBe('document')
    expect(reservedUnicode.unrepresentable).toBe(true)
    expect(reservedUnicode.diagnostics[0].line).toBe(3)
  })

  test('validates formats, explicit nulls, and handles unsupported dialects without throwing', () => {
    const validator = new EntryJsonValidator('links', {
      type: 'object',
      properties: {
        url: { type: 'string', format: 'uri' },
        note: { type: ['string', 'null'] },
        strictTitle: { type: 'string' },
      },
    })

    expect(validator.validate('{"url": "{{SITE_URL}}/launch"}').ok).toBe(false)
    expect(validator.validate('{"url": "https://silo.dev/launch", "note": null}').ok).toBe(true)
    expect(validator.validate('{"strictTitle": null}').ok).toBe(false)

    const unsupported = new EntryJsonValidator('old', {
      $schema: 'http://json-schema.org/draft-04/schema#',
      type: 'object',
    })
    const res = unsupported.validate('{"a": 1}')
    expect(res.ok).toBe(false)
    expect(res.kind).toBe('schema_compile')
    expect(res.unrepresentable).toBe(false)
    expect(res.data).toEqual({ a: 1 })
  })

  test('rejects overflow/precision-losing numbers and $async schemas', () => {
    const validator = new EntryJsonValidator('nums', {
      type: 'object',
      properties: { amount: { type: ['number', 'null'] } },
    })

    const inf = validator.validate('{"amount": 1e400}')
    expect(inf.ok).toBe(false)
    expect(inf.unrepresentable).toBe(true)
    expect(inf.data).toBeNull()

    const lossy = validator.validate('{"amount": 9007199254740993}')
    expect(lossy.ok).toBe(false)
    expect(lossy.unrepresentable).toBe(true)
    expect(lossy.data).toBeNull()

    const asyncValidator = new EntryJsonValidator('async', {
      $async: true,
      type: 'object',
      properties: { n: { type: 'number' } },
    })
    const asyncRes = asyncValidator.validate('{"n": false}')
    expect(asyncRes.ok).toBe(false)
    expect(asyncRes.kind).toBe('schema_compile')
  })

  test('handles discriminated oneOf errors, if/contains predicates, media URLs, and empty/propertyNames keys', () => {
    const unionValidator = new EntryJsonValidator('entities', {
      type: 'object',
      oneOf: [
        {
          type: 'object',
          required: ['type', 'name'],
          properties: { type: { const: 'person' }, name: { type: 'string' } },
        },
        {
          type: 'object',
          required: ['type', 'org'],
          properties: { type: { const: 'company' }, org: { type: 'string' } },
        },
      ],
    })

    const missingName = unionValidator.validate('{"type": "person"}')
    expect(missingName.ok).toBe(false)
    expect(missingName.hasUnknownProperties).toBe(false)
    expect(missingName.diagnostics.some((d) => d.message.includes('"name"'))).toBe(true)

    const withTypo = unionValidator.validate('{"type": "person", "name": "Ada", "typo": 1}')
    expect(withTypo.ok).toBe(false)
    expect(withTypo.hasUnknownProperties).toBe(true)

    const mediaValidator = new EntryJsonValidator('media_test', {
      type: 'object',
      properties: {
        cover: { type: 'string', 'x-silo-type': 'media', pattern: '^silo://media/' },
      },
      propertyNames: { pattern: '^[a-z]+$' },
    })

    const displayUrl = mediaValidator.validate(
      '{"cover": "https://cms.example.com/media/01ARZ3NDEKTSV4RRFFQ69G5FAV"}',
    )
    expect(displayUrl.ok).toBe(true)

    const emptyKeyText = '{"": 1}'
    const emptyKeyRes = mediaValidator.validate(emptyKeyText)
    expect(emptyKeyRes.ok).toBe(false)
    expect(emptyKeyRes.diagnostics.length).toBeGreaterThanOrEqual(1)
    for (const diag of emptyKeyRes.diagnostics) {
      expect(diag.from).toBe(1)
      expect(diag.to).toBe(3)
      expect(emptyKeyText.slice(diag.from, diag.to)).toBe('""')
    }
  })
})
