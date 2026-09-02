import { describe, expect, test } from 'bun:test'
import { SchemaDraft } from './schema-draft'
import type { SchemaField } from './schema-field'

const documentWith = (properties: Record<string, unknown>) =>
  JSON.stringify({
    $schema: SchemaDraft.SchemaUrl,
    type: 'object',
    properties,
  })

/** Parse, change nothing, build: exactly what one visual-mode save does. */
const save = (properties: Record<string, unknown>, edit?: (fields: SchemaField[]) => void) => {
  const state = SchemaDraft.parse(documentWith(properties))
  edit?.(state.fields)
  const built = JSON.parse(SchemaDraft.build(state.base, state.fields, state.auth))
  return { fields: state.fields, properties: built.properties }
}

describe('SchemaDraft', () => {
  describe('parse', () => {
    test('reads the kind through the declared union, not off the raw keyword', () => {
      const { fields } = save({
        numeric_code: { type: ['integer', 'null'] },
        rate: { type: ['number', 'null'] },
        active: { type: ['boolean', 'null'] },
        name: { type: ['string', 'null'] },
      })

      expect(fields.map((field) => field.kind)).toEqual([
        'integer',
        'number',
        'boolean',
        'string',
      ])
    })

    test('records nullability separately from the kind', () => {
      const { fields } = save({
        nullable: { type: ['integer', 'null'] },
        plain: { type: 'integer' },
      })

      expect(fields[0].nullable).toBeTrue()
      expect(fields[1].nullable).toBeFalse()
    })

    test('treats a genuine multi-type union as a construct, like oneOf', () => {
      const { fields } = save({
        either: { type: ['string', 'number'] },
        choice: { oneOf: [{ type: 'string' }, { type: 'number' }] },
      })

      expect(fields[0].construct).toBe('type union')
      expect(fields[1].construct).toBe('oneOf')
    })

    test('reads a property that declares no type as `any`, not as a string', () => {
      const { fields } = save({ payload: {}, title: { type: 'string' } })

      expect(fields[0].kind).toBe('any')
      expect(fields[0].construct).toBeUndefined()
      expect(fields[1].kind).toBe('string')
    })

    test('a blank field is not nullable', () => {
      expect(SchemaDraft.blankField().nullable).toBeFalse()
    })
  })

  describe('build', () => {
    test('a nullable integer survives a save it did not touch', () => {
      const { properties } = save({ numeric_code: { type: ['integer', 'null'] } })

      expect(properties.numeric_code).toEqual({ type: ['integer', 'null'] })
    })

    test('a nullable string survives a save it did not touch', () => {
      const { properties } = save({ name: { type: ['string', 'null'] } })

      expect(properties.name).toEqual({ type: ['string', 'null'] })
    })

    test('a multi-type union is left intact, to be edited in Code view', () => {
      const { properties } = save({
        either: { type: ['string', 'number'], description: 'one or the other' },
      })

      expect(properties.either).toEqual({
        type: ['string', 'number'],
        description: 'one or the other',
      })
    })

    test('a plain type is written back as a plain type, with no null bolted on', () => {
      const { properties } = save({ title: { type: 'string' }, count: { type: 'integer' } })

      expect(properties.title).toEqual({ type: 'string' })
      expect(properties.count).toEqual({ type: 'integer' })
    })

    test('changing the kind keeps the nullability, which the stored rows still need', () => {
      const { properties } = save({ numeric_code: { type: ['integer', 'null'] } }, (fields) => {
        fields[0].kind = 'string'
      })

      expect(properties.numeric_code).toEqual({ type: ['string', 'null'] })
    })

    test('a nullable list of references is still a list of references', () => {
      const { fields, properties } = save({
        tags: { type: ['array', 'null'], items: { $ref: 'silo://collections/tags' } },
      })

      expect(fields[0].kind).toBe('ref-array')
      expect(properties.tags).toEqual({
        type: ['array', 'null'],
        items: { $ref: 'silo://collections/tags' },
      })
    })

    test('a nullable enum and a nullable media field keep their union too', () => {
      const { fields, properties } = save({
        status: { type: ['string', 'null'], enum: ['draft', 'live', null] },
        cover: { type: ['string', 'null'], 'x-silo-type': 'media' },
      })

      // `null` is not a choice on the list an author edits; it is what the
      // nullable flag means for an enum, so it comes out and goes back in.
      expect(fields[0].enumValues).toEqual(['draft', 'live'])
      expect(properties.status).toEqual({ type: ['string', 'null'], enum: ['draft', 'live', null] })
      expect(properties.cover).toEqual({ type: ['string', 'null'], 'x-silo-type': 'media' })
    })

    /**
     * `["string", "null"]` beside `["draft", "live"]` is a field that can never
     * be null: `type` permits it and `enum` refuses it. The builder used to
     * write exactly that, so the first save of an imported Strapi enumeration
     * made every empty row unstorable — silently, until someone edited one.
     */
    test('a nullable enum saves a null that its own type already allows', () => {
      const { properties } = save({ status: { type: 'string', enum: ['draft', 'live'] } }, (fields) => {
        fields[0].nullable = true
      })

      expect(properties.status).toEqual({ type: ['string', 'null'], enum: ['draft', 'live', null] })
    })

    test('a JSON column stays typeless, rather than narrowing to a string', () => {
      const { properties } = save({ payload: { description: 'Whatever was there' } })

      expect(properties.payload).toEqual({ description: 'Whatever was there' })
    })

    test('picking `any` widens a typed field, and picking a type narrows it back', () => {
      const widened = save({ payload: { type: ['string', 'null'] } }, (fields) => {
        fields[0].kind = 'any'
      })
      expect(widened.properties.payload).toEqual({})

      const narrowed = save({ payload: {} }, (fields) => {
        fields[0].kind = 'object'
      })
      expect(narrowed.properties.payload).toEqual({ type: 'object' })
    })

    test('an imported collection survives a save that edits one description', () => {
      // The shape `StrapiColumns.schemaFor` writes for every column it imports.
      const imported = {
        numeric_code: { type: ['integer', 'null'] },
        name: { type: ['string', 'null'] },
        independent: { type: ['boolean', 'null'] },
        created_at: { type: ['string', 'null'] },
        // A `json` column: `StrapiColumns.schemaFor` declares no type at all.
        metadata: {},
      }
      const { properties } = save(imported, (fields) => {
        fields[1].description = 'Country name'
      })

      expect(properties).toEqual({
        ...imported,
        name: { ...imported.name, description: 'Country name' },
      })
    })
  })
})
