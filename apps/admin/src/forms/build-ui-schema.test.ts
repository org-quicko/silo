import { describe, test, expect } from 'bun:test'
import { buildUiSchema } from './build-ui-schema'

/**
 * **Widget selection has to survive nesting.**
 *
 * Every property a Strapi import writes is a nullable union, and every
 * component is an object or a list of them — so a walk that compares `type`
 * against `'object'` and never descends into `items` stopped at the first
 * component. The fields under one got no widget at all: a media reference two
 * levels down rendered as a text box holding `silo://media/<id>`, which is not
 * a thing anyone can edit.
 */
describe('choosing widgets through a nested schema', () => {
  const media = { type: ['string', 'null'], 'x-silo-type': 'media' }

  test('descends into a nullable object, which is what a component is', () => {
    const ui = buildUiSchema({
      type: 'object',
      properties: {
        connection: {
          type: ['object', 'null'],
          properties: { logo: media, note: { type: ['string', 'null'] } },
        },
      },
    })

    expect(ui).toEqual({ connection: { logo: { 'ui:widget': 'media' } } })
  })

  test('descends into the items of a repeatable component', () => {
    const ui = buildUiSchema({
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              icon: media,
              issues: { type: 'array', items: { type: 'object', properties: { glyph: media } } },
            },
          },
        },
      },
    })

    expect(ui).toEqual({
      items: {
        items: {
          icon: { 'ui:widget': 'media' },
          issues: { items: { glyph: { 'ui:widget': 'media' } } },
        },
      },
    })
  })

  test('still reads a list of plain strings as chips, nullable items included', () => {
    const ui = buildUiSchema({
      type: 'object',
      properties: { tags: { type: ['array', 'null'], items: { type: ['string', 'null'] } } },
    })

    expect(ui).toEqual({ tags: { 'ui:widget': 'tags' } })
  })

  test('a nullable object with nothing in it is raw JSON, not an empty group', () => {
    const ui = buildUiSchema({
      type: 'object',
      properties: { payload: { type: ['object', 'null'] } },
    })

    expect(ui).toEqual({ payload: { 'ui:field': 'json' } })
  })
})

/**
 * **`format: "uri"` is a URL, not a media reference.**
 *
 * It used to pick the media picker on its own, which made the schema editor's
 * URL format unusable: an author asking for a link got a control that writes
 * `silo://media/<id>`. A media field says so with `x-silo-type: "media"` —
 * which is what every importer writes and what the server rewrites on read —
 * and `cell-format.ts` already read the two apart this way, so the entries list
 * and the entry form now agree about which is which.
 */
describe('telling a URL field from a media one', () => {
  test('a plain uri string gets no widget, so RJSF draws its own URL input', () => {
    const ui = buildUiSchema({
      type: 'object',
      properties: { homepage: { type: 'string', format: 'uri' } },
    })

    expect(ui).toEqual({})
  })

  test('the media keyword still picks the picker, whatever the format says', () => {
    const ui = buildUiSchema({
      type: 'object',
      properties: { cover: { type: 'string', format: 'uri', 'x-silo-type': 'media' } },
    })

    expect(ui).toEqual({ cover: { 'ui:widget': 'media' } })
  })

  test('a schema asking for the picker by name still gets it', () => {
    const ui = buildUiSchema({
      type: 'object',
      properties: { cover: { type: 'string', format: 'uri', 'x-silo-ui': { widget: 'media' } } },
    })

    expect(ui).toEqual({ cover: { 'ui:widget': 'media' } })
  })
})
