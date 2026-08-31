import { describe, expect, test } from 'bun:test'
import type { MediaPolicyView } from '../../../api/types/media-settings'
import { MediaPolicyDraft } from './media-policy-draft'

const view = (patch: Partial<MediaPolicyView> = {}): MediaPolicyView => ({
  file: {},
  in_force: { base_url_target: 'server', extensions: ['jpg', 'png'] },
  overrides: [],
  default_extensions: ['jpg', 'png', 'pdf'],
  config_path: '/srv/silo.toml',
  writable: true,
  ...patch,
})

/**
 * The rules that keep the library form honest (D46).
 *
 * The seeding rule is the one worth pinning, because it is the opposite of
 * `MediaStorageDraft`'s and the reason is not obvious: the base URL comes from
 * the file so an unset one stays unset, and the extension list falls back to
 * what is in force so the box never shows nothing while something is being
 * enforced.
 */
describe('MediaPolicyDraft', () => {
  test('the base URL is seeded from the file, so an unset one stays unset', () => {
    const draft = MediaPolicyDraft.of(view({ in_force: { base_url: 'https://from-env.example.com', base_url_target: 'server', extensions: ['png'] } }))
    expect(draft.base_url).toBe('')
  })

  test('the extension list falls back to what is in force, never to empty', () => {
    // An empty list accepts nothing and the server refuses to save one, so a
    // form seeded with `[]` would be unsubmittable from the moment it loaded.
    expect(MediaPolicyDraft.of(view()).extensions).toEqual(['jpg', 'png'])
  })

  test('a freshly loaded form is not dirty', () => {
    const loaded = view()
    expect(MediaPolicyDraft.changed(MediaPolicyDraft.of(loaded), loaded)).toBe(false)
  })

  test('an edit is detected', () => {
    const loaded = view()
    const draft = { ...MediaPolicyDraft.of(loaded), base_url: 'https://cms.example.com' }
    expect(MediaPolicyDraft.changed(draft, loaded)).toBe(true)
  })

  describe('add', () => {
    test('dots and case come off, the way the server would clean them', () => {
      expect(MediaPolicyDraft.add([], '.JPG')).toEqual(['jpg'])
    })

    test('a pasted list splits on commas', () => {
      expect(MediaPolicyDraft.add(['jpg'], 'png, .GIF , webp')).toEqual([
        'jpg',
        'png',
        'gif',
        'webp',
      ])
    })

    test('a duplicate is not added twice', () => {
      expect(MediaPolicyDraft.add(['jpg'], 'jpg')).toEqual(['jpg'])
    })

    test('nothing typed adds nothing', () => {
      expect(MediaPolicyDraft.add(['jpg'], '  ,  ')).toEqual(['jpg'])
    })
  })

  test('remove takes exactly one', () => {
    expect(MediaPolicyDraft.remove(['jpg', 'png'], 'jpg')).toEqual(['png'])
  })

  test('the wildcard is recognised, so the page can say so in words', () => {
    expect(MediaPolicyDraft.acceptsEverything(['*'])).toBe(true)
    expect(MediaPolicyDraft.acceptsEverything(['jpg'])).toBe(false)
  })

  test('the payload sends every field, since an omitted one reads as cleared', () => {
    expect(
      MediaPolicyDraft.payload({
        base_url: '  https://cms.example.com  ',
        base_url_target: 'store',
        extensions: ['png'],
      })
    ).toEqual({
      base_url: 'https://cms.example.com',
      base_url_target: 'store',
      extensions: ['png'],
    })
  })
})
