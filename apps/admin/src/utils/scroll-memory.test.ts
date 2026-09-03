import { afterEach, describe, expect, test } from 'bun:test'
import { ScrollMemory } from './scroll-memory'

afterEach(() => ScrollMemory.clear())

describe('ScrollMemory', () => {
  test('a view nobody has scrolled starts at the top', () => {
    expect(ScrollMemory.get('/collections/posts')).toBe(0)
  })

  test('each view remembers its own place', () => {
    ScrollMemory.set('/collections/posts', 420)
    ScrollMemory.set('/collections/posts?page=2', 90)

    expect(ScrollMemory.get('/collections/posts')).toBe(420)
    expect(ScrollMemory.get('/collections/posts?page=2')).toBe(90)
  })

  test('forget drops one view back to the top', () => {
    ScrollMemory.set('/collections/posts', 420)
    ScrollMemory.forget('/collections/posts')

    expect(ScrollMemory.get('/collections/posts')).toBe(0)
  })

  // A long session moves between many views, and none of them is worth holding
  // a number for forever.
  test('the oldest write is evicted past the limit, and a rewrite is not old', () => {
    for (let index = 0; index < 24; index += 1) ScrollMemory.set(`/view/${index}`, index + 1)

    // Touched again, so /view/0 is now the most recent rather than the oldest.
    ScrollMemory.set('/view/0', 999)
    ScrollMemory.set('/view/24', 25)

    expect(ScrollMemory.get('/view/0')).toBe(999)
    expect(ScrollMemory.get('/view/24')).toBe(25)
    expect(ScrollMemory.get('/view/1')).toBe(0)
  })
})
