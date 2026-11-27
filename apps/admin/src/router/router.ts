import { useMemo, useSyncExternalStore } from 'react'
import { Routes } from './routes'
import type { Route } from './route'

type NavigationBlocker = (proceed: () => void) => void

interface NavigateOptions {
  replace?: boolean
  force?: boolean
  state?: Record<string, unknown>
}

interface InternalHistoryState {
  __siloPos?: number
  __siloNavId?: number
  [key: string]: unknown
}

// A History-API store the whole app subscribes to. The admin UI needs ~10
// routes and no data loaders, so this stays smaller than pulling in a router
// dependency — and it keeps the single-binary UI bundle lean.
export class BrowserRouter {
  private listeners = new Set<() => void>()
  private snapshot: string
  private blocker: NavigationBlocker | null = null
  private position = 0
  private navId = 0
  private nextNavId = 1
  private reverting = false
  private bypassPopstate = false
  private pendingPopstateDelta: number | null = null

  constructor() {
    this.snapshot = BrowserRouter.read()
    if (typeof window !== 'undefined') {
      const existing = (window.history.state as InternalHistoryState | null) || {}
      if (typeof existing.__siloPos === 'number') {
        this.position = existing.__siloPos
      }
      if (typeof existing.__siloNavId === 'number') {
        this.navId = existing.__siloNavId
        this.nextNavId = Math.max(this.nextNavId, this.navId + 1)
      }
      if (typeof existing.__siloPos !== 'number' || typeof existing.__siloNavId !== 'number') {
        window.history.replaceState(
          { ...existing, __siloPos: this.position, __siloNavId: this.navId },
          '',
        )
      }
      window.addEventListener('popstate', (event) => this.onPopState(event))
    }
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = (): string => this.snapshot

  getState<T extends Record<string, unknown> = Record<string, unknown>>(): T | null {
    if (typeof window === 'undefined') return null
    const state = window.history.state
    return state && typeof state === 'object' ? (state as T) : null
  }

  getNavId(): number {
    return this.navId
  }

  /** Updates fields on the active history entry without navigating or creating history. */
  patchState(patch: Record<string, unknown>): void {
    if (typeof window === 'undefined') return
    const current = (window.history.state as InternalHistoryState | null) || {}
    window.history.replaceState(
      { ...current, ...patch, __siloPos: this.position, __siloNavId: this.navId },
      '',
    )
  }

  /**
   * Registers an active navigation guard. While installed, `navigate` and
   * `popstate` hand `proceed` to `blocker` instead of leaving the route.
   */
  block(blocker: NavigationBlocker): () => void {
    this.blocker = blocker
    return () => {
      if (this.blocker === blocker) this.blocker = null
    }
  }

  /**
   * `replace` for corrections the user shouldn't have to click back through
   * (redirects, debounced filter typing); push for real navigations.
   */
  navigate(to: string, options: NavigateOptions = {}): void {
    if (to === this.snapshot) return
    if (!options.force && this.blocker) {
      const activeBlocker = this.blocker
      activeBlocker(() => {
        if (this.blocker === activeBlocker) this.blocker = null
        this.navigate(to, { ...options, force: true })
      })
      return
    }
    this.pendingPopstateDelta = null
    if (typeof window !== 'undefined') {
      const extraState = options.state ? { ...options.state } : {}
      if (options.replace) {
        window.history.replaceState(
          { ...extraState, __siloPos: this.position, __siloNavId: this.navId },
          '',
          to,
        )
      } else {
        this.position += 1
        this.navId = this.nextNavId++
        window.history.pushState(
          { ...extraState, __siloPos: this.position, __siloNavId: this.navId },
          '',
          to,
        )
      }
    }
    this.sync()
  }

  back(): void {
    if (typeof window !== 'undefined') window.history.back()
  }

  private onPopState(event: PopStateEvent): void {
    const next = BrowserRouter.read()
    const eventState = (event.state as InternalHistoryState | null) || {}
    const parsedPosition = typeof eventState.__siloPos === 'number' ? eventState.__siloPos : null
    const parsedNavId = typeof eventState.__siloNavId === 'number' ? eventState.__siloNavId : null

    if (this.reverting) {
      this.reverting = false
      if (parsedPosition !== null) this.position = parsedPosition
      if (parsedNavId !== null) this.navId = parsedNavId
      const queuedDelta = this.pendingPopstateDelta
      this.pendingPopstateDelta = null
      if (queuedDelta !== null && queuedDelta !== 0) {
        this.bypassPopstate = true
        window.history.go(queuedDelta)
      }
      return
    }

    if (this.bypassPopstate) {
      this.bypassPopstate = false
      if (parsedPosition !== null) this.position = parsedPosition
      if (parsedNavId !== null) this.navId = parsedNavId
      this.sync()
      return
    }

    if (next === this.snapshot) {
      if (parsedPosition !== null) this.position = parsedPosition
      if (parsedNavId !== null) this.navId = parsedNavId
      return
    }

    if (this.blocker) {
      const activeBlocker = this.blocker
      const delta = parsedPosition !== null ? parsedPosition - this.position : null

      if (delta !== null && delta !== 0 && typeof window.history.go === 'function') {
        this.reverting = true
        window.history.go(-delta)
        activeBlocker(() => {
          if (this.blocker === activeBlocker) this.blocker = null
          if (this.reverting) {
            this.pendingPopstateDelta = delta
            return
          }
          this.bypassPopstate = true
          window.history.go(delta)
        })
        return
      }

      window.history.pushState(
        { __siloPos: this.position, __siloNavId: this.navId },
        '',
        this.snapshot,
      )
      activeBlocker(() => {
        if (this.blocker === activeBlocker) this.blocker = null
        this.navigate(next, { replace: true, force: true })
      })
      return
    }

    if (parsedPosition !== null) this.position = parsedPosition
    if (parsedNavId !== null) this.navId = parsedNavId
    this.sync()
  }

  private static read(): string {
    if (typeof window === 'undefined') return '/'
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
