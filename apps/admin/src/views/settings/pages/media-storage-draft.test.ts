import { describe, expect, test } from 'bun:test'
import type { MediaStorageView } from '../../../api/types/media-storage'
import { MediaStorageDraft } from './media-storage-draft'

const view = (patch: Partial<MediaStorageView> = {}): MediaStorageView => ({
  file: { driver: 'fs', secret_access_key_set: false },
  in_force: { driver: 'fs', secret_access_key_set: false },
  drivers: ['fs', 's3'],
  overrides: [],
  config_path: '/srv/silo.toml',
  writable: true,
  ...patch,
})

/**
 * The rules that keep the form honest (D45).
 *
 * Every one of these is a way the page could lie: seeding the boxes from what
 * is in force and then saving a derived path back as a literal, hiding the
 * environment variable that is beating the field somebody just typed, or
 * dropping a driver from the select so an operator saves a change they never
 * made.
 */
describe('MediaStorageDraft', () => {
  test('a draft is seeded from the file, never from what is in force', () => {
    // The fs media path follows the data dir while nobody has named one, so
    // this is the case where saving what is in force would pin media in place.
    const draft = MediaStorageDraft.of(
      view({ in_force: { driver: 'fs', path: '/data/media', secret_access_key_set: false } }).file,
    )
    expect(draft.path).toBe('')
    expect(MediaStorageDraft.changed(draft, { driver: 'fs', secret_access_key_set: false })).toBe(
      false,
    )
  })

  test('every value is a string or a boolean, so no input goes uncontrolled', () => {
    const draft = MediaStorageDraft.of({ driver: 's3', secret_access_key_set: true })
    expect(Object.values(draft).every((value) => typeof value === 'string' || typeof value === 'boolean')).toBe(true)
  })

  test('an edit is detected against the file', () => {
    const file = { driver: 's3', bucket: 'one', secret_access_key_set: false }
    const draft = MediaStorageDraft.of(file)
    expect(MediaStorageDraft.changed(draft, file)).toBe(false)
    expect(MediaStorageDraft.changed({ ...draft, bucket: 'two' }, file)).toBe(true)
  })

  describe('payload', () => {
    const draft = MediaStorageDraft.of({ driver: 's3', bucket: 'one', secret_access_key_set: true })

    test('an untouched secret is not sent, so the file keeps the one it holds', () => {
      expect('secret_access_key' in MediaStorageDraft.payload(draft, '', false)).toBe(false)
    })

    test('an empty secret is sent only when it was deliberately cleared', () => {
      expect(MediaStorageDraft.payload(draft, '', true).secret_access_key).toBe('')
    })

    test('a typed secret beats the clear that opened the box for it', () => {
      // Clearing is how a stored secret is replaced, so both flags are set at
      // once. Reading the clear first would throw away what was just typed and
      // leave the instance with no credential at all.
      expect(MediaStorageDraft.payload(draft, 'AKIA-new', true).secret_access_key).toBe('AKIA-new')
    })
  })

  describe('shows', () => {
    test('fs takes a directory and s3 takes a bucket', () => {
      expect(MediaStorageDraft.shows('fs')).toEqual({ directory: true, bucket: false })
      expect(MediaStorageDraft.shows('s3')).toEqual({ directory: false, bucket: true })
    })

    test("a plugin's driver takes everything, because nothing here knows what it reads", () => {
      expect(MediaStorageDraft.shows('acme-gcs')).toEqual({ directory: true, bucket: true })
    })
  })

  describe('options', () => {
    test('the server decides the list', () => {
      expect(MediaStorageDraft.options(view({ drivers: ['fs', 's3', 'acme-gcs'] }))).toEqual([
        'fs',
        's3',
        'acme-gcs',
      ])
    })

    test('a driver this build can no longer open is still offered', () => {
      // The provider plugin was uninstalled. Dropping the value would make the
      // select propose a driver change nobody chose, and a save would take it.
      const options = MediaStorageDraft.options(
        view({ file: { driver: 'acme-gcs', secret_access_key_set: false } }),
      )
      expect(options).toContain('acme-gcs')
    })
  })

  describe('inUse', () => {
    test('a field the file decides has nothing to say', () => {
      expect(MediaStorageDraft.inUse(view(), 'bucket')).toBeNull()
    })

    test('an environment variable is named with the value it supplies', () => {
      const found = MediaStorageDraft.inUse(
        view({
          in_force: { driver: 's3', bucket: 'from-env', secret_access_key_set: false },
          overrides: [{ field: 'bucket', env: 'SILO_BLOB_S3_BUCKET' }],
        }),
        'bucket',
      )
      expect(found).toEqual({ value: 'from-env', env: 'SILO_BLOB_S3_BUCKET' })
    })

    test('a field cleared by the environment reports that, rather than nothing', () => {
      const found = MediaStorageDraft.inUse(
        view({ overrides: [{ field: 'region', env: 'SILO_BLOB_S3_REGION' }] }),
        'region',
      )
      expect(found).toEqual({ value: 'nothing', env: 'SILO_BLOB_S3_REGION' })
    })

    test('the secret is reported as a fact, never as a value', () => {
      const found = MediaStorageDraft.inUse(
        view({
          in_force: { driver: 's3', secret_access_key_set: true },
          overrides: [{ field: 'secret_access_key', env: 'SILO_BLOB_S3_SECRET_ACCESS_KEY' }],
        }),
        'secret_access_key',
      )
      expect(found).toEqual({
        value: 'a different secret',
        env: 'SILO_BLOB_S3_SECRET_ACCESS_KEY',
      })
    })

    test('a boolean reads as on or off', () => {
      const found = MediaStorageDraft.inUse(
        view({
          in_force: { driver: 's3', force_path_style: true, secret_access_key_set: false },
          overrides: [{ field: 'force_path_style' }],
        }),
        'force_path_style',
      )
      expect(found).toEqual({ value: 'on' })
    })
  })
})
