import { useMemo, useSyncExternalStore } from 'react'
import { Routes } from './routes'
import type { Route } from './route'

// A History-API store the whole app subscribes to. The admin UI needs ~10
// routes and no data loaders, so this stays smaller than pulling in a router
// dependency — and it keeps the single-binary UI bundle lean.
class BrowserRouter {
  private listeners = new Set<() => void>()
  private snapshot: string

  constructor() {
    this.snapshot = BrowserRouter.read()
    window.addEventListener('popstate', () => this.sync())
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = (): string => this.snapshot

  /**
   * `replace` for corrections the user shouldn't have to click back through
   * (redirects, debounced filter typing); push for real navigations.
   */
  navigate(to: string, opts: { replace?: boolean } = {}): void {
    if (to === BrowserRouter.read()) return
    if (opts.replace) window.history.replaceState(null, '', to)
    else window.history.pushState(null, '', to)
    this.sync()
  }

  back(): void {
    window.history.back()
  }

  private static read(): string {
    return window.location.pathname + window.location.search
  }

  private sync(): void {
    const next = BrowserRouter.read()
    if (next === this.snapshot) return
    this.snapshot = next
    for (const listener of this.listeners) listener()
  }
}

export const router = new BrowserRouter()

export function useLocation(): string {
  return useSyncExternalStore(router.subscribe, router.getSnapshot, router.getSnapshot)
}

export function useRoute(): Route | null {
  const location = useLocation()
  return useMemo(() => Routes.parse(location), [location])
}
