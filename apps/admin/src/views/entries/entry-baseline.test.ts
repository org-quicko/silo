import { describe, expect, test } from 'bun:test'
import { getDefaultFormState, type RJSFSchema } from '@rjsf/utils'
import validator from '@rjsf/validator-ajv8'
import { ConflictError } from '../../api/api-error'
import type { Entry } from '../../api/types/entry'
import { EntryBaseline } from './entry-baseline'

function sampleEntry(rev: number, data: Record<string, unknown>): Entry {
  return {
    id: '01J0ENTRYID',
    collection: 'posts',
    rev,
    seq: rev,
    data,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

describe('EntryBaseline.isDataEqual', () => {
  test('ignores key ordering and undefined properties', () => {
    expect(EntryBaseline.isDataEqual({ title: 'Hi', tags: ['a'] }, { tags: ['a'], title: 'Hi' })).toBe(true)
    expect(EntryBaseline.isDataEqual({ title: 'Hi', note: undefined }, { title: 'Hi' })).toBe(true)
  })

  test('distinguishes explicit null from omitted property', () => {
    expect(EntryBaseline.isDataEqual({ title: 'Hi', meta: null }, { title: 'Hi' })).toBe(false)
    expect(EntryBaseline.isDataEqual({ meta: { note: null } }, { meta: {} })).toBe(false)
    expect(EntryBaseline.isDataEqual({ meta: { note: null } }, { meta: { note: null } })).toBe(true)
  })
})

describe('EntryBaseline.planModeSwitch', () => {
  test('refuses Form -> JSON switch when a media upload is pending or any JsonField is invalid', () => {
    expect(
      EntryBaseline.planModeSwitch({
        from: 'form',
        to: 'json',
        mediaUploading: true,
        invalidJsonFieldCount: 0,
        jsonText: '{}',
      }),
    ).toEqual({
      ok: false,
      target: 'mediaUpload',
      error: 'Wait for the media upload to finish before saving.',
    })

    const plan = EntryBaseline.planModeSwitch({
      from: 'form',
      to: 'json',
      invalidJsonFieldCount: 1,
      jsonText: '{}',
    })
    expect(plan).toEqual({
      ok: false,
      target: 'jsonField',
      error: 'Fix invalid JSON fields before switching to JSON mode.',
    })
  })

  test('allows Form -> JSON switch when JsonFields are valid and validates JSON -> Form', () => {
    expect(
      EntryBaseline.planModeSwitch({
        from: 'form',
        to: 'json',
        invalidJsonFieldCount: 0,
        jsonText: '{}',
      }),
    ).toEqual({ ok: true, action: 'toJson' })

    expect(
      EntryBaseline.planModeSwitch({
        from: 'json',
        to: 'form',
        invalidJsonFieldCount: 0,
        jsonText: '{ "id": "01ABC" }',
      }).ok,
    ).toBe(false)

    expect(
      EntryBaseline.planModeSwitch({
        from: 'json',
        to: 'form',
        invalidJsonFieldCount: 0,
        jsonText: '{ "title": "Hi", "meta": null }',
      }),
    ).toEqual({ ok: true, action: 'toForm', data: { title: 'Hi', meta: null } })
  })
})

describe('EntryBaseline.defaultFormStateBehavior', () => {
  const schema: RJSFSchema = {
    type: 'object',
    properties: {
      meta: {
        type: 'object',
        properties: {
          locale: { type: 'string', default: 'en' },
        },
      },
      tag: { type: 'string', const: 'fixed' },
    },
  }

  test('populates defaults for fresh new entries and skips empty-object & const defaults on existing or JSON-edited forms', () => {
    const newBehavior = EntryBaseline.defaultFormStateBehavior(false, false)
    const editBehavior = EntryBaseline.defaultFormStateBehavior(true, false)
    const jsonEditedBehavior = EntryBaseline.defaultFormStateBehavior(false, true)

    expect(newBehavior.emptyObjectFields).toBe('populateAllDefaults')
    expect(newBehavior.constAsDefaults).toBe('always')
    expect(editBehavior.emptyObjectFields).toBe('skipDefaults')
    expect(editBehavior.constAsDefaults).toBe('never')
    expect(jsonEditedBehavior.emptyObjectFields).toBe('skipDefaults')
    expect(jsonEditedBehavior.constAsDefaults).toBe('never')

    // Verify with @rjsf/utils that `{}` stays intact (no synthesized `locale` or `tag` const)!
    const existingData = { meta: {} }
    expect(getDefaultFormState(validator, schema, existingData, schema, false, editBehavior)).toEqual({
      meta: {},
    })
    expect(getDefaultFormState(validator, schema, existingData, schema, false, jsonEditedBehavior)).toEqual({
      meta: {},
    })
    expect(getDefaultFormState(validator, schema, {}, schema, false, editBehavior)).toEqual({})
    expect(getDefaultFormState(validator, schema, {}, schema, false, jsonEditedBehavior)).toEqual({})
    expect(getDefaultFormState(validator, schema, existingData, schema, false, newBehavior)).toEqual({
      meta: { locale: 'en' },
      tag: 'fixed',
    })
  })
})

describe('EntryBaseline.isDirty', () => {
  test('counts invalid JsonField and invalid JSON mode text as dirty even when formData matches', () => {
    const baseline = { title: 'Hi' }
    expect(
      EntryBaseline.isDirty({
        formData: { title: 'Hi' },
        baselineData: baseline,
        mode: 'form',
        invalidJsonFieldCount: 1,
        jsonError: null,
      }),
    ).toBe(true)
    expect(
      EntryBaseline.isDirty({
        formData: { title: 'Hi' },
        baselineData: baseline,
        mode: 'json',
        invalidJsonFieldCount: 0,
        jsonError: 'Unexpected token',
      }),
    ).toBe(true)
    expect(
      EntryBaseline.isDirty({
        formData: { title: 'Hi' },
        baselineData: baseline,
        mode: 'form',
        invalidJsonFieldCount: 0,
        jsonError: null,
      }),
    ).toBe(false)
  })
})

describe('EntryBaseline SWR adoption & stale detection', () => {
  test('adopts newer server revision or refreshed data while clean, and locks once dirty', () => {
    const clean = sampleEntry(3, { title: 'v3' })
    const initial = EntryBaseline.create(clean)

    expect(
      EntryBaseline.shouldAdoptServerEntry({
        entry: sampleEntry(3, { title: 'v3' }),
        dirty: false,
        baselineRev: initial.rev,
        lastServerJson: initial.serverJson,
      }),
    ).toBe(false)

    const newer = sampleEntry(4, { title: 'v4' })
    expect(
      EntryBaseline.shouldAdoptServerEntry({
        entry: newer,
        dirty: false,
        baselineRev: initial.rev,
        lastServerJson: initial.serverJson,
      }),
    ).toBe(true)

    expect(
      EntryBaseline.shouldAdoptServerEntry({
        entry: newer,
        dirty: true,
        baselineRev: initial.rev,
        lastServerJson: initial.serverJson,
      }),
    ).toBe(false)

    // Background SWR refresh mid-media-upload must keep the clean form in place
    // rather than resetting pending uploads, while stale detection surfaces the newer rev.
    expect(
      EntryBaseline.shouldAdoptServerEntry({
        entry: newer,
        dirty: false,
        mediaUploading: true,
        baselineRev: initial.rev,
        lastServerJson: initial.serverJson,
      }),
    ).toBe(false)

    expect(EntryBaseline.isStale(newer, initial.rev)).toBe(true)
    expect(EntryBaseline.isStale(clean, initial.rev)).toBe(false)
  })

  test('detects 409 ConflictError instances and 409 status objects', () => {
    expect(EntryBaseline.isConflictError(new ConflictError('conflict', 'r', 'p'))).toBe(true)
    expect(EntryBaseline.isConflictError({ status: 409, message: 'conflict' })).toBe(true)
    expect(EntryBaseline.isConflictError(new Error('other'))).toBe(false)
  })
})
