import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../../api/silo-api'
import type { ScopeRecord } from '../../api/types/scope-record'
import type { ScopeRef } from '../../api/types/scope-ref'
import type { SettingsRoute } from '../../router/route'
import { ScopeMemory } from '../../utils/scope-memory'

export interface SettingsScope {
  /** `null` only until the server answers, or when it hosts no project. */
  scope: ScopeRef | null
  /** Names, for the two switchers. */
  projects: string[]
  environments: string[]
  /**
   * The same two lists as records (D51), for the pages that need an `id` — a
   * rename is addressed by name and bound to the id, so a page offering one has
   * to hold both.
   */
  projectRecords: ScopeRecord[]
  environmentRecords: ScopeRecord[]
  loadingProjects: boolean
  loadingEnvironments: boolean
  error: string
  reloadProjects: () => Promise<void>
  reloadEnvironments: () => Promise<void>
}

/**
 * Resolves the (project, env) the settings nav is pointing at, and keeps the
 * two lists its switchers offer.
 *
 * Server-level pages (keys, transfer, connection, appearance) carry no scope
 * in their URL by design, so the nav's PROJECT and ENVIRONMENT groups would
 * otherwise have nowhere to link. Resolution order — **route, then the
 * remembered scope, then the first thing the server lists** — keeps the URL
 * authoritative wherever it says anything, falls back to where the user last
 * was, and only guesses when there is nothing else to go on.
 */
export function useSettingsScope(
  url: string,
  apiKey: string,
  serverId: string,
  route: SettingsRoute,
): SettingsScope {
  const routeProject = route.view === 'server-settings' ? null : route.project
  const routeEnv = route.view === 'env-settings' ? route.env : null

  const [projectRecords, setProjectRecords] = useState<ScopeRecord[]>([])
  const [environmentRecords, setEnvironmentRecords] = useState<ScopeRecord[]>([])
  const [loadingProjects, setLoadingProjects] = useState(true)
  const [loadingEnvironments, setLoadingEnvironments] = useState(false)
  const [error, setError] = useState('')

  const projects = useMemo(() => projectRecords.map((record) => record.name), [projectRecords])
  const environments = useMemo(
    () => environmentRecords.map((record) => record.name),
    [environmentRecords],
  )

  const remembered = ScopeMemory.get(serverId)
  const project = routeProject ?? ScopeMemory.pick(remembered?.project, projects, loadingProjects)
  // The remembered env only applies to the project it was remembered with;
  // "prod" in one project says nothing about another.
  const rememberedEnv = remembered && remembered.project === project ? remembered.env : null
  const env = routeEnv ?? ScopeMemory.pick(rememberedEnv, environments, loadingEnvironments)
  const scope = project && env ? { project, env } : null

  const reloadProjects = useCallback(async () => {
    setLoadingProjects(true)
    try {
      setProjectRecords(await api.projects.list(url, apiKey))
    } catch (caught: any) {
      setError(caught.message || 'Failed to load projects')
    } finally {
      setLoadingProjects(false)
    }
  }, [url, apiKey])

  const reloadEnvironments = useCallback(async () => {
    if (!project) {
      setEnvironmentRecords([])
      return
    }
    setLoadingEnvironments(true)
    try {
      setEnvironmentRecords(await api.projects.listEnvironments(url, apiKey, project))
    } catch (caught: any) {
      setError(caught.message || 'Failed to load environments')
    } finally {
      setLoadingEnvironments(false)
    }
  }, [url, apiKey, project])

  useEffect(() => {
    reloadProjects()
  }, [reloadProjects])

  useEffect(() => {
    reloadEnvironments()
  }, [reloadEnvironments])

  // Remember whatever fully resolved, so the next unscoped page inherits it.
  useEffect(() => {
    if (scope) ScopeMemory.set(serverId, scope)
  }, [serverId, scope?.project, scope?.env])

  return {
    scope,
    projects,
    environments,
    projectRecords,
    environmentRecords,
    loadingProjects,
    loadingEnvironments,
    error,
    reloadProjects,
    reloadEnvironments,
  }
}
