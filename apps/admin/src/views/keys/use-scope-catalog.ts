import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../api/silo-api'
import { KeyScopes, type KeyScope } from './key-scope'

/** `acme/prod`, the cache key a scope's collections are held under. */
function scopeKey(scope: KeyScope): string {
  return `${scope.project}/${scope.env}`
}

/**
 * The projects, environments and collections the key form offers, loaded once
 * per subject and kept.
 *
 * The form went from naming one scope to naming a list of them, and a list is
 * what makes a cache necessary: a per-row `useEffect` would refetch the same
 * project's environments for every row that names it, and refetch all of them
 * whenever any row changed. Asking here, keyed by subject, means a row added
 * for a project already on screen costs nothing.
 *
 * A failed load caches the empty list rather than retrying, for the reason the
 * single-scope form swallowed the same error: the segment is still typeable and
 * the server is the authority on whether it exists, so a picker that cannot
 * suggest is a smaller problem than a picker that retries on every keystroke.
 */
export function useScopeCatalog(url: string, apiKey: string) {
  const [projects, setProjects] = useState<string[]>([])
  const [environments, setEnvironments] = useState<Record<string, string[]>>({})
  const [collections, setCollections] = useState<Record<string, string[]>>({})
  const pending = useRef(new Set<string>())

  useEffect(() => {
    let alive = true
    api.projects
      .list(url, apiKey)
      .then((records) => alive && setProjects(records.map((record) => record.name)))
      .catch(() => alive && setProjects([]))
    return () => {
      alive = false
    }
  }, [url, apiKey])

  const loadEnvironments = useCallback(
    (project: string) => {
      if (!project || KeyScopes.isAny(project)) return
      const token = `env:${project}`
      if (pending.current.has(token)) return
      pending.current.add(token)

      api.projects
        .listEnvironments(url, apiKey, project)
        .then((records) =>
          setEnvironments((held) => ({ ...held, [project]: records.map((record) => record.name) })),
        )
        .catch(() => setEnvironments((held) => ({ ...held, [project]: [] })))
    },
    [url, apiKey],
  )

  const loadCollections = useCallback(
    (scope: KeyScope) => {
      // Only a scope naming one concrete environment has a collection list:
      // the same name under a wildcard is a different collection in every
      // scope it matches, so there is nothing to enumerate.
      if (!KeyScopes.complete(scope)) return
      if (KeyScopes.isAny(scope.project) || KeyScopes.isAny(scope.env)) return

      const token = `coll:${scopeKey(scope)}`
      if (pending.current.has(token)) return
      pending.current.add(token)

      api.collections
        .list(url, apiKey, { project: scope.project, env: scope.env })
        .then((items) =>
          setCollections((held) => ({ ...held, [scopeKey(scope)]: items.map((item) => item.name) })),
        )
        .catch(() => setCollections((held) => ({ ...held, [scopeKey(scope)]: [] })))
    },
    [url, apiKey],
  )

  return {
    projects,
    /** Known environments of one project, empty until it has been asked for. */
    environmentsOf: (project: string) => environments[project] ?? [],
    /** Every environment name seen anywhere, as suggestions for a wildcard
     *  project — where the answer is a *name*, not one project's list. */
    knownEnvironments: [...new Set(Object.values(environments).flat())].sort(),
    collectionsOf: (scope: KeyScope) => collections[scopeKey(scope)] ?? [],
    loadEnvironments,
    loadCollections,
  }
}

export type ScopeCatalog = ReturnType<typeof useScopeCatalog>
