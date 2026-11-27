import { describe, expect, test } from 'bun:test'
import { MediaPickerQuery, type MediaPickerState } from './media-picker-query'
import { RequestSequence } from './request-sequence'

class Deferred<T> {
  readonly promise: Promise<T>
  resolve!: (value: T) => void
  reject!: (reason?: unknown) => void

  constructor() {
    this.promise = new Promise<T>((res, rej) => {
      this.resolve = res
      this.reject = rej
    })
  }
}

describe('RequestSequence', () => {
  test('accepts only the most recently issued request id', () => {
    const sequence = new RequestSequence()
    const first = sequence.next()
    expect(sequence.isCurrent(first)).toBe(true)

    const second = sequence.next()
    expect(second).toBeGreaterThan(first)
    expect(sequence.isCurrent(first)).toBe(false)
    expect(sequence.isCurrent(second)).toBe(true)
  })

  test('invalidate marks any in-flight request stale', () => {
    const sequence = new RequestSequence()
    const pending = sequence.next()
    expect(sequence.isCurrent(pending)).toBe(true)

    sequence.invalidate()
    expect(sequence.isCurrent(pending)).toBe(false)
  })

  test('superseded request invalidated during search debounce cannot clamp or overwrite state', async () => {
    const listSequence = new RequestSequence()
    let query: MediaPickerState = MediaPickerQuery.withPage(MediaPickerQuery.initial(), 5)
    let visibleItems: string[] = ['initial']
    let loading = false

    const firstFetch = new Deferred<{ items: string[]; total: number }>()
    const firstId = listSequence.next()
    loading = true
    const firstTask = firstFetch.promise.then((page) => {
      if (!listSequence.isCurrent(firstId)) return
      if (page.total > 0) {
        const clamped = MediaPickerQuery.clampPage(query, page.total)
        if (clamped.page !== query.page) {
          query = clamped
          return
        }
      }
      visibleItems = page.items
      loading = false
    })

    // User types a search query while the previous page-5 request is in-flight
    // (before the 250ms debounce fires the next loadList).
    listSequence.invalidate()
    query = MediaPickerQuery.withSearch(query, 'hero')

    // Late page-5 response returns with small total during debounce window.
    firstFetch.resolve({ items: ['stale'], total: 10 })
    await firstTask

    expect(query).toMatchObject({ search: 'hero', page: 1 })
    expect(visibleItems).toEqual(['initial'])
    expect(loading).toBe(true)

    // Debounced search request fires and commits cleanly.
    const secondFetch = new Deferred<{ items: string[]; total: number }>()
    const secondId = listSequence.next()
    const secondTask = secondFetch.promise.then((page) => {
      if (!listSequence.isCurrent(secondId)) return
      visibleItems = page.items
      loading = false
    })
    secondFetch.resolve({ items: ['hero.png'], total: 1 })
    await secondTask

    expect(visibleItems).toEqual(['hero.png'])
    expect(loading).toBe(false)
  })

  test('late upload invalidated by choose, close, or reopen never overwrites newer choice', async () => {
    const uploadSequence = new RequestSequence()
    let selectedValue = 'silo://media/existing'
    let uploadError = ''
    let uploading = false
    let pickerOpen = true

    const uploadRequest = new Deferred<string>()
    const uploadId = uploadSequence.next()
    uploading = true

    const uploadTask = uploadRequest.promise
      .then((uploadedId) => {
        if (!uploadSequence.isCurrent(uploadId)) return
        selectedValue = `silo://media/${uploadedId}`
        pickerOpen = false
      })
      .catch((caught: unknown) => {
        if (!uploadSequence.isCurrent(uploadId)) return
        uploadError = caught instanceof Error ? caught.message : 'Upload failed'
      })
      .finally(() => {
        if (uploadSequence.isCurrent(uploadId)) {
          uploading = false
        }
      })

    // User chooses an asset or closes the dialog before the slow upload finishes.
    uploadSequence.invalidate()
    uploading = false
    selectedValue = 'silo://media/chosen'
    pickerOpen = false

    // Late upload resolves (or even fails later): must not touch value, open, or uploading.
    uploadRequest.resolve('late-upload')
    await uploadTask

    expect(selectedValue).toBe('silo://media/chosen')
    expect(pickerOpen).toBe(false)
    expect(uploading).toBe(false)
    expect(uploadError).toBe('')

    // A rejected late upload after reopen also stays ignored.
    const secondUpload = new Deferred<string>()
    const secondId = uploadSequence.next()
    uploading = true
    const secondTask = secondUpload.promise
      .catch((caught: unknown) => {
        if (!uploadSequence.isCurrent(secondId)) return
        uploadError = caught instanceof Error ? caught.message : 'Upload failed'
      })
      .finally(() => {
        if (uploadSequence.isCurrent(secondId)) {
          uploading = false
        }
      })

    // User reopens picker, invalidating second upload and resetting uploading.
    uploadSequence.invalidate()
    uploading = false
    pickerOpen = true

    secondUpload.reject(new Error('network error'))
    await secondTask

    expect(uploadError).toBe('')
    expect(uploading).toBe(false)
    expect(pickerOpen).toBe(true)
  })
})
