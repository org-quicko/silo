import { describe, test, expect } from 'bun:test'
import { FormSchema } from './form-schema'
import { buildUiSchema } from './build-ui-schema'

/**
 * **A property that declares nothing has to survive to the form.**
 *
 * RJSF returns `null` for a schema with no keywords, before `ui:field` is read,
 * so `{ "json": {} }` — what a Strapi JSON column imports as, and what the
 * schema editor's `any` kind saves — rendered as a blank page: the field was
 * not shown, not editable, and not reported missing either. The pairing with
 * `buildUiSchema` is asserted here rather than left to two files agreeing by
 * eye, because the mark is only worth anything if it lands on the JSON field.
 */
describe('the schema the entry form is given', () => {
  test('marks a property that constrains nothing, so RJSF keeps it', () => {
    const marked = FormSchema.forEntry({
      type: 'object',
      properties: { json: {}, credential: { description: 'Empty in this export.' } },
    })

    expect(marked.properties.json).toEqual({ 'x-silo-ui': { widget: 'json' } })
    expect(marked.properties.credential['x-silo-ui']).toEqual({ widget: 'json' })
    expect(buildUiSchema(marked)).toEqual({
      json: { 'ui:field': 'json' },
      credential: { 'ui:field': 'json' },
    })
  })

  test('leaves every property that does declare a control alone', () => {
    const schema = {
      type: 'object',
      properties: {
        title: { type: ['string', 'null'] },
        status: { enum: ['draft', 'live'] },
        cover: { $ref: '#/$defs/media' },
        blocks: { type: 'array', items: { type: 'object', properties: {} } },
      },
    }
    expect(FormSchema.forEntry(schema)).toEqual(schema)
  })

  test('reaches a JSON column inside a component, and inside a list of them', () => {
    const marked = FormSchema.forEntry({
      type: 'object',
      properties: {
        connection: { type: 'object', properties: { api: {} } },
        items: { type: 'array', items: { type: 'object', properties: { payload: {} } } },
      },
    })

    expect(marked.properties.connection.properties.api['x-silo-ui']).toEqual({ widget: 'json' })
    expect(marked.properties.items.items.properties.payload['x-silo-ui']).toEqual({ widget: 'json' })
  })

  test('keeps a widget the schema already asked for', () => {
    const marked = FormSchema.forEntry({
      type: 'object',
      properties: { notes: { 'x-silo-ui': { order: ['a'] } } },
    })

    expect(marked.properties.notes['x-silo-ui']).toEqual({ order: ['a'], widget: 'json' })
  })
})
