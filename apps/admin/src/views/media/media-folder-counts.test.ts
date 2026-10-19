import { describe, expect, test } from 'bun:test'
import { MediaFolderCounts } from './media-folder-counts'

const tick = () => new Promise((resolve) => setTimeout(resolve, 1))

describe('MediaFolderCounts.load', () => {
  test('keeps at most MaxInFlight requests out and counts every path', async () => {
    const paths = Array.from({ length: 50 }, (_, i) => `/brands/${i}`)
    let inFlight = 0
    let most = 0
    const counts = await MediaFolderCounts.load(paths, async (path) => {
      inFlight++
      most = Math.max(most, inFlight)
      await tick()
      inFlight--
      return path.length
    })

    expect(most).toBe(MediaFolderCounts.MaxInFlight)
    expect(Object.keys(counts).sort()).toEqual([...paths].sort())
    expect(counts['/brands/42']).toBe('/brands/42'.length)
  })

  test('fewer paths than the cap all go out at once', async () => {
    let most = 0
    let inFlight = 0
    const counts = await MediaFolderCounts.load(['/a', '/b'], async () => {
      inFlight++
      most = Math.max(most, inFlight)
      await tick()
      inFlight--
      return 3
    })

    expect(most).toBe(2)
    expect(counts).toEqual({ '/a': 3, '/b': 3 })
  })

  test('starts nothing new once aborted, and keeps the counts already in', async () => {
    const abort = new AbortController()
    const asked: string[] = []
    const counts = await MediaFolderCounts.load(
      ['/a', '/b', '/c', '/d', '/e'],
      async (path) => {
        asked.push(path)
        if (path === '/c') abort.abort()
        await tick()
        return 1
      },
      abort.signal,
      1,
    )

    expect(asked).toEqual(['/a', '/b', '/c'])
    expect(counts).toEqual({ '/a': 1, '/b': 1, '/c': 1 })
  })

  test('an empty list asks nothing', async () => {
    let asked = 0
    const counts = await MediaFolderCounts.load([], async () => {
      asked++
      return 1
    })

    expect(asked).toBe(0)
    expect(counts).toEqual({})
  })
})
