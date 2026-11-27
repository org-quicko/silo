import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { BrowserRouter } from './router'

interface HistoryEntry {
  url: string
  state: unknown
}

function installMockWindow(initialUrl: string, options: { asyncGo?: boolean } = {}) {
  const entries: HistoryEntry[] = [{ url: initialUrl, state: null }]
  let cursor = 0
  const listeners = new Map<string, Set<(event: unknown) => void>>()
  const pendingTimers: Promise<void>[] = []

  const parseUrl = (url: string) => {
    const [pathname, search] = url.split('?')
    return { pathname: pathname || '/', search: search ? `?${search}` : '' }
  }

  const location = parseUrl(initialUrl)
  const syncLocation = () => {
    const parts = parseUrl(entries[cursor].url)
    location.pathname = parts.pathname
    location.search = parts.search
  }

  const emit = (type: string, event: unknown) => {
    for (const listener of listeners.get(type) ?? []) listener(event)
  }

  const history = {
    get state() {
      return entries[cursor].state
    },
    pushState(state: unknown, _title: string, url?: string) {
      entries.splice(cursor + 1)
      entries.push({ url: url ?? entries[cursor].url, state })
      cursor = entries.length - 1
      syncLocation()
    },
    replaceState(state: unknown, _title: string, url?: string) {
      entries[cursor] = { url: url ?? entries[cursor].url, state }
      syncLocation()
    },
    go(delta: number) {
      const target = cursor + delta
      if (target < 0 || target >= entries.length) return
      const complete = () => {
        cursor = target
        syncLocation()
        emit('popstate', { state: entries[cursor].state })
      }
      if (options.asyncGo) {
        const task = new Promise<void>((resolve) => {
          setTimeout(() => {
            complete()
            resolve()
          }, 0)
        })
        pendingTimers.push(task)
      } else {
        complete()
      }
    },
    back() {
      history.go(-1)
    },
  }

  const mockWindow = {
    location,
    history,
    addEventListener(type: string, listener: (event: unknown) => void) {
      const set = listeners.get(type) ?? new Set()
      set.add(listener)
      listeners.set(type, set)
    },
  }

  ;(globalThis as { window?: unknown }).window = mockWindow
  const flushAsync = async () => {
    while (pendingTimers.length > 0) {
      const batch = pendingTimers.splice(0, pendingTimers.length)
      await Promise.all(batch)
    }
  }
  return { entries, getCursor: () => cursor, history, flushAsync }
}

describe('BrowserRouter navigation blocker', () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window
  })

  beforeEach(() => {
    delete (globalThis as { window?: unknown }).window
  })

  test('navigates immediately when no blocker is active and stores route state', () => {
    installMockWindow('/servers/s1/projects/p/environments/dev/collections/posts')
    const testRouter = new BrowserRouter()
    testRouter.navigate('/servers/s1/media', { state: { returnToken: 'tok-1' } })
    expect(testRouter.getSnapshot()).toBe('/servers/s1/media')
    expect(testRouter.getState<{ returnToken?: string }>()?.returnToken).toBe('tok-1')
  })

  test('blocks navigate until proceed is invoked, and force bypasses the blocker', () => {
    installMockWindow('/servers/s1/projects/p/environments/dev/collections/posts/entries/1')
    const testRouter = new BrowserRouter()
    let pendingProceed: (() => void) | null = null

    testRouter.block((proceed) => {
      pendingProceed = proceed
    })

    testRouter.navigate('/servers/s1/media')
    expect(testRouter.getSnapshot()).toBe('/servers/s1/projects/p/environments/dev/collections/posts/entries/1')
    expect(pendingProceed).not.toBeNull()

    pendingProceed!()
    expect(testRouter.getSnapshot()).toBe('/servers/s1/media')

    testRouter.block(() => {
      throw new Error('blocker must not run when force is true')
    })
    testRouter.navigate('/servers/s1/trash', { force: true })
    expect(testRouter.getSnapshot()).toBe('/servers/s1/trash')
  })

  test('blocks browser back (popstate), stays at snapshot when kept, and goes back on proceed', () => {
    const mock = installMockWindow('/servers/s1/projects/p/environments/dev/collections/posts?q=hi')
    const testRouter = new BrowserRouter()
    testRouter.navigate('/servers/s1/projects/p/environments/dev/collections/posts/entries/1')

    let pendingProceed: (() => void) | null = null
    let notifications = 0
    testRouter.subscribe(() => {
      notifications += 1
    })
    testRouter.block((proceed) => {
      pendingProceed = proceed
    })

    mock.history.back()
    expect(testRouter.getSnapshot()).toBe('/servers/s1/projects/p/environments/dev/collections/posts/entries/1')
    expect(window.location.pathname).toBe('/servers/s1/projects/p/environments/dev/collections/posts/entries/1')
    expect(notifications).toBe(0)
    expect(pendingProceed).not.toBeNull()

    pendingProceed!()
    expect(testRouter.getSnapshot()).toBe('/servers/s1/projects/p/environments/dev/collections/posts?q=hi')
    expect(notifications).toBe(1)
  })

  test('handles deferred async popstate reversal both after settle and when proceed runs mid-revert', async () => {
    const mock = installMockWindow('/servers/s1/projects/p/environments/dev/collections/posts?q=hi', {
      asyncGo: true,
    })
    const testRouter = new BrowserRouter()
    testRouter.navigate('/servers/s1/projects/p/environments/dev/collections/posts/entries/1')

    let pendingProceed: (() => void) | null = null
    let notifications = 0
    testRouter.subscribe(() => {
      notifications += 1
    })
    testRouter.block((proceed) => {
      pendingProceed = proceed
    })

    // Case 1: Back fires asynchronously, revert completes before user responds -> Keep editing stays put.
    mock.history.back()
    await mock.flushAsync()
    expect(testRouter.getSnapshot()).toBe('/servers/s1/projects/p/environments/dev/collections/posts/entries/1')
    expect(notifications).toBe(0)
    expect(pendingProceed).not.toBeNull()

    // Case 2: Confirming proceed AFTER deferred reversal settles goes back cleanly.
    pendingProceed!()
    await mock.flushAsync()
    expect(testRouter.getSnapshot()).toBe('/servers/s1/projects/p/environments/dev/collections/posts?q=hi')
    expect(notifications).toBe(1)

    // Case 3: Go forward again, block, hit back, and call proceed BEFORE deferred revert settles.
    testRouter.navigate('/servers/s1/projects/p/environments/dev/collections/posts/entries/2')
    pendingProceed = null
    testRouter.block((proceed) => {
      pendingProceed = proceed
    })
    mock.history.back()
    await new Promise((resolve) => setTimeout(resolve, 0))
    // Right after initial async popstate arrives, go(+1) is queued; confirm proceed immediately mid-revert.
    expect(pendingProceed).not.toBeNull()
    pendingProceed!()
    await mock.flushAsync()
    expect(testRouter.getSnapshot()).toBe('/servers/s1/projects/p/environments/dev/collections/posts?q=hi')
  })

  test('releasing blocker lets subsequent navigations pass immediately', () => {
    installMockWindow('/servers/s1/media')
    const testRouter = new BrowserRouter()
    const release = testRouter.block(() => {
      throw new Error('should have been released')
    })
    release()
    testRouter.navigate('/servers/s1/trash')
    expect(testRouter.getSnapshot()).toBe('/servers/s1/trash')
  })
})
