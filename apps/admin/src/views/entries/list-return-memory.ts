import type { ScopeRef } from '../../api/types/scope-ref'
import { Routes } from '../../router/routes'

const STORAGE_KEY = 'silo_entry_return_targets'
const MAX_STORED = 32

export interface ListReturnTarget {
  serverId: string
  project: string
  env: string
  collection: string
  returnTo: string
  focusEntryId: string | null
}

/**
 * Per-navigation return target (`{ returnTo, focusEntryId }`) stored by
 * navigation token so `history.state` scopes list origins strictly to the
 * navigation that opened `EntryForm` — preserving Back/Forward across A vs B
 * without leaking A's origin onto a `⌘K` deep-link jump.
 */
export class ListReturnMemory {
  private static readonly fallback = new Map<string, ListReturnTarget>()
  private static counter = 0

  static save(
    serverId: string,
    scope: ScopeRef,
    collection: string,
    target: { returnTo: string; focusEntryId: string | null },
  ): string | null {
    if (!ListReturnMemory.matches(target.returnTo, serverId, scope, collection)) return null
    const token = `ret-${Date.now()}-${++ListReturnMemory.counter}`
    const record: ListReturnTarget = {
      serverId,
      project: scope.project,
      env: scope.env,
      collection,
      returnTo: target.returnTo,
      focusEntryId: target.focusEntryId,
    }
    const all = ListReturnMemory.readAll()
    delete all[token]
    all[token] = record
    const keys = Object.keys(all)
    while (keys.length > MAX_STORED) {
      const oldest = keys.shift()
      if (oldest) delete all[oldest]
    }
    ListReturnMemory.writeAll(all)
    return token
  }

  static get(
    token: string | null | undefined,
    serverId: string,
    scope: ScopeRef,
    collection: string,
  ): { returnTo: string; focusEntryId: string | null } | null {
    if (!token) return null
    const record = ListReturnMemory.readAll()[token]
    if (!record) return null
    if (
      record.serverId !== serverId ||
      record.project !== scope.project ||
      record.env !== scope.env ||
      record.collection !== collection
    ) {
      return null
    }
    if (!ListReturnMemory.matches(record.returnTo, serverId, scope, collection)) return null
    return { returnTo: record.returnTo, focusEntryId: record.focusEntryId ?? null }
  }

  static clearAll(): void {
    ListReturnMemory.fallback.clear()
    try {
      ListReturnMemory.storage()?.removeItem(STORAGE_KEY)
    } catch {
      // Ignore unavailable storage.
    }
  }

  private static storage(): Storage | null {
    try {
      return typeof sessionStorage === 'undefined' ? null : sessionStorage
    } catch {
      return null
    }
  }

  private static matches(
    url: string,
    serverId: string,
    scope: ScopeRef,
    collection: string,
  ): boolean {
    const parsed = Routes.parse(url)
    return (
      parsed !== null &&
      parsed.view === 'entries' &&
      parsed.serverId === serverId &&
      parsed.project === scope.project &&
      parsed.env === scope.env &&
      parsed.collection === collection
    )
  }

  private static readAll(): Record<string, ListReturnTarget> {
    const memory = Object.fromEntries(ListReturnMemory.fallback.entries())
    const storage = ListReturnMemory.storage()
    if (!storage) return memory
    try {
      const raw = storage.getItem(STORAGE_KEY)
      if (!raw) return memory
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { ...(parsed as Record<string, ListReturnTarget>), ...memory }
      }
    } catch {
      return memory
    }
    return memory
  }

  private static writeAll(all: Record<string, ListReturnTarget>): void {
    ListReturnMemory.fallback.clear()
    for (const [key, value] of Object.entries(all)) {
      ListReturnMemory.fallback.set(key, value)
    }
    try {
      ListReturnMemory.storage()?.setItem(STORAGE_KEY, JSON.stringify(all))
    } catch {
      // In-memory fallback map retains records for this session.
    }
  }
}
