import { describe, expect, test } from 'bun:test'
import { MediaPickerQuery } from './media-picker-query'

describe('MediaPickerQuery', () => {
  test('starts on page 1 with default page size and empty filters', () => {
    expect(MediaPickerQuery.initial()).toEqual({
      search: '',
      folder: '',
      type: '',
      page: 1,
      pageSize: 24,
    })
  })

  test('changing search, folder, type, or page size resets page to 1', () => {
    const paged = MediaPickerQuery.withPage(MediaPickerQuery.initial(), 5)
    expect(paged.page).toBe(5)

    expect(MediaPickerQuery.withSearch(paged, 'hero')).toMatchObject({
      search: 'hero',
      page: 1,
    })
    expect(MediaPickerQuery.withFolder(paged, '/marketing')).toMatchObject({
      folder: '/marketing',
      page: 1,
    })
    expect(MediaPickerQuery.withType(paged, 'image/')).toMatchObject({
      type: 'image/',
      page: 1,
    })
    expect(MediaPickerQuery.withPageSize(paged, 48)).toMatchObject({
      pageSize: 48,
      page: 1,
    })
  })

  test('clamps invalid page and page size values safely', () => {
    const initial = MediaPickerQuery.initial()
    expect(MediaPickerQuery.withPage(initial, 0).page).toBe(1)
    expect(MediaPickerQuery.withPage(initial, -3).page).toBe(1)
    expect(MediaPickerQuery.withPage(initial, Number.NaN).page).toBe(1)
    expect(MediaPickerQuery.withPage(initial, 3.8).page).toBe(3)
    expect(MediaPickerQuery.withPageSize(initial, 0).pageSize).toBe(MediaPickerQuery.DefaultPageSize)
  })

  test('translates All folders to recursive true and browses past item 100', () => {
    const state = MediaPickerQuery.withPage(MediaPickerQuery.initial(), 6)
    expect(MediaPickerQuery.toApiQuery(state)).toEqual({
      q: undefined,
      folder: undefined,
      recursive: true,
      type: undefined,
      limit: 24,
      offset: 120,
    })
  })

  test('translates specific folder to recursive false with trimmed search and MIME prefix', () => {
    let state = MediaPickerQuery.initial()
    state = MediaPickerQuery.withFolder(state, '/marketing/launch')
    state = MediaPickerQuery.withType(state, 'image/')
    state = MediaPickerQuery.withSearch(state, '  banner  ')
    state = MediaPickerQuery.withPage(state, 2)

    expect(MediaPickerQuery.toApiQuery(state)).toEqual({
      q: 'banner',
      folder: '/marketing/launch',
      recursive: false,
      type: 'image/',
      limit: 24,
      offset: 24,
    })
    expect(MediaPickerQuery.uploadFolder(state)).toBe('/marketing/launch')
    expect(MediaPickerQuery.hasActiveFilters(state)).toBe(true)
  })

  test('uploadFolder returns undefined when All folders is selected', () => {
    const state = MediaPickerQuery.initial()
    expect(MediaPickerQuery.uploadFolder(state)).toBeUndefined()
    expect(MediaPickerQuery.hasActiveFilters(state)).toBe(false)
  })

  test('clampPage moves out-of-range pages back to the last valid page', () => {
    const pageFive = MediaPickerQuery.withPage(MediaPickerQuery.initial(), 5)
    expect(MediaPickerQuery.clampPage(pageFive, 49).page).toBe(3)
    expect(MediaPickerQuery.clampPage(pageFive, 48).page).toBe(2)
    expect(MediaPickerQuery.clampPage(pageFive, 0).page).toBe(1)

    const pageTwo = MediaPickerQuery.withPage(MediaPickerQuery.initial(), 2)
    expect(MediaPickerQuery.clampPage(pageTwo, 48)).toBe(pageTwo)
  })
})
