import { describe, expect, test } from 'bun:test'
import { buildUiSchema } from '../../forms/build-ui-schema'
import { FormSchema } from '../../forms/form-schema'
import { MediaValue } from '../../forms/widgets/media-value'
import { FormCompatibility } from './form-compatibility'

describe('FormCompatibility.check', () => {
  test('blocks non-primitive items inside tags-widget arrays while allowing strings and any-fields', () => {
    const raw = {
      type: 'object',
      properties: {
        tags: { type: 'array' },
        payload: {},
      },
    }
    const formSchema = FormSchema.forEntry(raw)
    const uiSchema = buildUiSchema(formSchema)

    expect(FormCompatibility.check({ tags: ['alpha', 'beta'], payload: { nested: [1] } }, formSchema, uiSchema)).toEqual({
      ok: true,
      error: null,
    })

    const badTags = FormCompatibility.check({ tags: [{ a: 1 }] }, formSchema, uiSchema)
    expect(badTags.ok).toBe(false)
    expect(badTags.error).toContain('tags[0]')
  })

  test('blocks scalar values where Form expects a structured object or array, while letting JsonField subtrees pass', () => {
    const raw = {
      type: 'object',
      properties: {
        author: {
          type: 'object',
          properties: { name: { type: 'string' } },
        },
        blocks: {
          type: 'array',
          items: { type: 'object', properties: { title: { type: 'string' } } },
        },
        anyOfField: {
          oneOf: [{ type: 'string' }, { type: 'object', required: ['name'], properties: { name: { type: 'string' } } }],
        },
      },
    }
    const formSchema = FormSchema.forEntry(raw)
    const uiSchema = buildUiSchema(formSchema)

    expect(FormCompatibility.check({ author: 'wrong' }, formSchema, uiSchema).ok).toBe(false)
    expect(FormCompatibility.check({ blocks: 'not-array' }, formSchema, uiSchema).ok).toBe(false)
    expect(FormCompatibility.check({ anyOfField: {} }, formSchema, uiSchema).ok).toBe(true)
    expect(FormCompatibility.check({ author: { name: 'Ada' }, blocks: [{ title: 'One' }] }, formSchema, uiSchema).ok).toBe(true)
  })

  test('blocks non-string values for media and scalar fields and guards MediaValue helpers', () => {
    const raw = {
      type: 'object',
      properties: {
        cover: { type: 'string', 'x-silo-type': 'media' },
        title: { type: 'string' },
      },
    }
    const formSchema = FormSchema.forEntry(raw)
    const uiSchema = buildUiSchema(formSchema)

    expect(FormCompatibility.check({ cover: {} }, formSchema, uiSchema).ok).toBe(false)
    expect(FormCompatibility.check({ title: { nested: [] } }, formSchema, uiSchema).ok).toBe(false)
    expect(FormCompatibility.check({ cover: null, title: 'Ok' }, formSchema, uiSchema).ok).toBe(true)

    expect(MediaValue.previewUrl({} as any, 'https://example.com')).toBe('')
    expect(MediaValue.looksLikeImage({} as any)).toBe(false)
    expect(MediaValue.displayName({} as any, null)).toBe('')
  })
})
