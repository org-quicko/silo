import { useEffect, useState } from 'react'
import { Claims } from '@silo/shared/claims'
import { api } from '../../api/silo-api'
import type { Server } from './server'

/** What the three-column browser is currently pointed at. */
export interface ScopeSelection {
  serverId: string | null
  project: string | null
  env: string | null
}

/**
 * Walks server → project → environment, loading each column from the one
 * before it.
 *
 * Every fetch is cancellable, because switching servers twice quickly would
 * otherwise let the first response overwrite the second.
 */
export function useScopeBrowser(servers: Server[], initial: ScopeSelection) {
  const [serverId, setServerId] = useState<string | null>(initial.serverId)
  const [project, setProject] = useState<string | null>(initial.project)
  const [env, setEnv] = useState<string | null>(initial.env)

  const [projects, setProjects] = useState<string[]>([])
  const [environments, setEnvironments] = useState<string[]>([])
  const [loadingProjects, setLoadingProjects] = useState(false)
  const [loadingEnvironments, setLoadingEnvironments] = useState(false)
  const [error, setError] = useState('')

  const server = servers.find((candidate) => candidate.id === serverId) || null

  useEffect(() => {
    if (!server) {
      setProjects([])
      setProject(null)
      setEnvironments([])
      setEnv(null)
      return
    }

    let cancelled = false
    setLoadingProjects(true)
    setError('')

    api.projects
      .list(server.url, server.apiKey)
      .then((items) => !cancelled && setProjects(items.map((record) => record.name)))
      .catch((failure: any) => {
        if (cancelled) return
        setProjects([])
        setError(failure.message || 'Failed to load projects')
      })
      .finally(() => !cancelled && setLoadingProjects(false))

    return () => {
      cancelled = true
    }
  }, [serverId, server?.url, server?.apiKey])

  useEffect(() => {
    if (!server || !project) {
      setEnvironments([])
      setEnv(null)
      return
    }

    let cancelled = false
    setLoadingEnvironments(true)
    setError('')

    api.projects
      .listEnvironments(server.url, server.apiKey, project)
      .then((items) => !cancelled && setEnvironments(items.map((record) => record.name)))
      .catch((failure: any) => {
        if (cancelled) return
        setEnvironments([])
        setError(failure.message || 'Failed to load environments')
      })
      .finally(() => !cancelled && setLoadingEnvironments(false))

    return () => {
      cancelled = true
    }
  }, [serverId, project, server?.url, server?.apiKey])

  /** Selecting a server clears everything to its right. */
  const selectServer = (id: string) => {
    setServerId(id)
    setProject(null)
    setEnv(null)
    setError('')
  }

  const selectProject = (name: string) => {
    setProject(name)
    setEnv(null)
    setError('')
  }

  const createProject = async (name: string): Promise<void> => {
    if (!server) return
    if (!Claims.isScopeId(name)) {
      setError(
        'Project name must start with lowercase letter and use [a-z0-9_-], max 64 chars.',
      )
      return
    }

    try {
      await api.projects.create(server.url, server.apiKey, name)
      setProjects((current) => (current.includes(name) ? current : [...current, name].sort()))
      setProject(name)
    } catch (failure: any) {
      setError(failure.message || 'Failed to create project')
      throw failure
    }
  }

  const createEnvironment = async (name: string): Promise<void> => {
    if (!server || !project) return
    if (!Claims.isScopeId(name)) {
      setError(
        'Environment name must start with lowercase letter and use [a-z0-9_-], max 64 chars.',
      )
      return
    }

    try {
      await api.projects.createEnvironment(server.url, server.apiKey, project, name)
      setEnvironments((current) =>
        current.includes(name) ? current : [...current, name].sort(),
      )
      setEnv(name)
    } catch (failure: any) {
      setError(failure.message || 'Failed to create environment')
      throw failure
    }
  }

  return {
    server,
    serverId,
    project,
    env,
    projects,
    environments,
    loadingProjects,
    loadingEnvironments,
    error,
    setError,
    setServerId,
    selectServer,
    selectProject,
    selectEnv: setEnv,
    createProject,
    createEnvironment,
    complete: Boolean(server && project && env),
  }
}
