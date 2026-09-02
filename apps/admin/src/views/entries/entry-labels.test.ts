import { describe, test, expect } from 'bun:test'
import { EntryLabels } from './entry-labels'
import type { Entry } from '../../api/types/entry'

const entry = (data: Record<string, unknown>): Entry =>
  ({
    id: '01M1GCQ6QBM1MFF0KRY284AQ0M',
    rev: 1,
    data,
    created_at: '2026-09-02T06:25:51.339Z',
    updated_at: '2026-09-02T06:25:51.339Z',
  }) as unknown as Entry

/**
 * **What the first column of the entries table says an entry is.**
 *
 * Every case here is a real collection from one Strapi import. A content type
 * whose only field is a repeatable component is ordinary in Strapi and was
 * unreadable in silo: `String(value)` on a list of four objects is
 * `[object Object],[object Object],[object Object],[object Object]`, and that
 * was the entry's title.
 */
describe('naming an entry in a list', () => {
  test('titles by a string field over a list that happens to be declared first', () => {
    const schema = {
      properties: {
        faqs: { type: 'array', items: { type: 'object' } },
        version: { type: ['string', 'null'] },
      },
    }
    expect(EntryLabels.pickPrimary(['faqs', 'version'], schema).primary).toBe('version')
  })

  test('still prefers title and name, and falls back to the first property there is', () => {
    const schema = { properties: { code: { type: 'integer' }, name: { type: 'string' } } }
    expect(EntryLabels.pickPrimary(['code', 'name'], schema).primary).toBe('name')

    // Nothing nameable at all: the only field is the list, and it heads the
    // table because there is nothing else to head it.
    const listOnly = { properties: { faqs: { type: 'array', items: { type: 'object' } } } }
    expect(EntryLabels.pickPrimary(['faqs'], listOnly).primary).toBe('faqs')
  })

  test('a media reference names a file, not the entry holding it', () => {
    const schema = {
      properties: {
        icon: { type: ['string', 'null'], 'x-silo-type': 'media' },
        label: { type: ['string', 'null'] },
      },
    }
    expect(EntryLabels.pickPrimary(['icon', 'label'], schema).primary).toBe('label')
  })

  test('a list of objects reads as its length', () => {
    const schema = { properties: { faqs: { type: 'array', items: { type: 'object' } } } }
    const four = entry({ faqs: [{ question: 'a' }, { question: 'b' }, { question: 'c' }, { question: 'd' }] })

    expect(EntryLabels.of(four, 'faqs', schema)).toBe('4 items')
    expect(EntryLabels.of(entry({ faqs: [{ question: 'a' }] }), 'faqs', schema)).toBe('1 item')
  })

  test('a list of scalars reads as itself', () => {
    const schema = { properties: { tags: { type: 'array', items: { type: 'string' } } } }
    expect(EntryLabels.of(entry({ tags: ['tax', 'gst'] }), 'tags', schema)).toBe('tax, gst')
  })

  test('an object is named by its first filled field, or counted', () => {
    const schema = { properties: { json: {} } }
    expect(EntryLabels.of(entry({ json: { name: 'Modules', at: 2026 } }), 'json', schema)).toBe('Modules')
    // Nothing scalar inside it — the count `CellValue` shows for the same value.
    expect(EntryLabels.of(entry({ json: { modules: { '2026': {} } } }), 'json', schema)).toBe('{ 1 key }')
  })

  test('an empty value falls back to the id, and no schema is still an answer', () => {
    const short = EntryLabels.of(entry({}), null)
    expect(short).toBe(EntryLabels.of(entry({ faqs: [] }), 'faqs'))
    expect(short).toBe(EntryLabels.of(entry({ title: '' }), 'title'))
    expect(short).not.toContain('object Object')
  })
})
