import { describe, expect, test } from 'bun:test'
import { MediaUploadPending } from './media-upload-pending'

describe('MediaUploadPending', () => {
  test('scopes active upload indicator to the matching server connection', () => {
    const serverA = MediaUploadPending.connectionKey('http://localhost:8090', 'key-a')
    expect(serverA).not.toBeNull()

    expect(MediaUploadPending.isUploading(serverA, 'http://localhost:8090', 'key-a')).toBe(true)
    expect(MediaUploadPending.isUploading(serverA, 'http://localhost:8090', 'key-b')).toBe(false)
    expect(MediaUploadPending.isUploading(serverA, 'http://localhost:8091', 'key-a')).toBe(false)
    expect(MediaUploadPending.isUploading(serverA, undefined, 'key-a')).toBe(false)
    expect(MediaUploadPending.isUploading(null, 'http://localhost:8090', 'key-a')).toBe(false)
  })

  test('tracks pending uploads independently per widget instance id across mount, completion, and unmount', () => {
    // RJSF widgets for `seo_meta` and `seo.meta` can share `props.id = "root_seo_meta"`,
    // so each mounted `MediaWidget` uses its own unique `useId()` key.
    const flatWidgetInstanceId = ':r1:'
    const nestedWidgetInstanceId = ':r2:'

    let pending = new Set<string>()

    // Initial mount reports false.
    pending = MediaUploadPending.applyChange(pending, flatWidgetInstanceId, false)
    expect(pending.size).toBe(0)

    // Both widgets start uploading -> tracked under distinct instance keys.
    pending = MediaUploadPending.applyChange(pending, flatWidgetInstanceId, true)
    pending = MediaUploadPending.applyChange(pending, nestedWidgetInstanceId, true)
    expect(pending.size).toBe(2)

    // First widget finishes -> second widget stays pending.
    pending = MediaUploadPending.applyChange(pending, flatWidgetInstanceId, false)
    expect(pending.has(flatWidgetInstanceId)).toBe(false)
    expect(pending.has(nestedWidgetInstanceId)).toBe(true)
    expect(pending.size).toBe(1)

    // Second widget unmounts mid-upload -> cleanup clears its key.
    pending = MediaUploadPending.applyChange(pending, nestedWidgetInstanceId, false)
    expect(pending.size).toBe(0)
  })
})
