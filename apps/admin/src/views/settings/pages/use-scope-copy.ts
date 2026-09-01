import { useEffect, useState } from 'react'
import { Claims } from '@silo/shared/claims'
import { api } from '../../../api/silo-api'
import type { ImportResult } from '../../../api/types/import-result'
import type { ScopeRef } from '../../../api/types/scope-ref'
import type { Server } from '../../servers/server'

/** Whether an existing collection is emptied first, or written over. */
export type ScopeCopyMode = 'merge' | 'replace'

/** Which side wins a conflict — empty means the server's default rule. */
export type ScopeCopyPrefer = '' | 'local' | 'remote'

/**
 * Copying one environment onto another of the same instance (D22).
 *
 * The destination is fixed — it is the settings scope — so the form only picks
 * a source. Every claim check is scope-wide, because a copy exercises exactly
 * the permissions a hand-rolled list-and-write loop would need and no
 * `transfer:*` claim at all.
 */
export function useScopeCopy(server: Server, destination: ScopeRef, claims: string[]) {
  const [sourceProject, setSourceProject] = useState(destination.project)
  const [sourceEnvironments, setSourceEnvironments] = useState<string[]>([])
  const [sourceEnv, setSourceEnv] = useState('')
  const [mode, setMode] = useState<ScopeCopyMode>('merge')
  const [prefer, setPrefer] = useState<ScopeCopyPrefer>('')

  const [preview, setPreview] = useState<ImportResult | null>(null)
  const [applied, setApplied] = useState<ImportResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const invalidate = () => {
    setPreview(null)
    setApplied(null)
    setError('')
  }

  // Default to a sibling environment: copying within a project is the common
  // case, and the destination itself is never a valid source.
  useEffect(() => {
    let alive = true
    api.projects
      .listEnvironments(server.url, server.apiKey, sourceProject)
      .then((records) => {
        if (!alive) return
        const eligible = records
          .map((record) => record.name)
          .filter(
          (env) => !(sourceProject === destination.project && env === destination.env),
        )
        setSourceEnvironments(eligible)
        setSourceEnv((current) => (eligible.includes(current) ? current : eligible[0] || ''))
      })
      .catch((caught: any) => {
        if (!alive) return
        setSourceEnvironments([])
        setSourceEnv('')
        setError(caught.message || 'Failed to load environments')
      })

    return () => {
      alive = false
    }
  }, [server.url, server.apiKey, sourceProject, destination.project, destination.env])

  const from: ScopeRef | null = sourceEnv
    ? { project: sourceProject, env: sourceEnv }
    : null

  const canRead =
    !!from &&
    Claims.hasScopeWide(claims, Claims.ScopeCopyReadPermissions, from.project, from.env)
  const canWrite = Claims.hasScopeWide(
    claims,
    Claims.ScopeCopyWritePermissions,
    destination.project,
    destination.env,
  )
  const canReplace = Claims.hasScopeWide(
    claims,
    Claims.ScopeCopyReplacePermissions,
    destination.project,
    destination.env,
  )

  const run = async (dryRun: boolean) => {
    if (!from) return
    setBusy(true)
    setError('')
    if (dryRun) invalidate()

    try {
      const result = await api.transfer.copyScope(server.url, server.apiKey, destination, {
        from,
        mode,
        prefer,
        dryRun,
      })
      if (dryRun) {
        setPreview(result)
      } else {
        setApplied(result)
        setPreview(null)
      }
    } catch (caught: any) {
      setError(caught.message || (dryRun ? 'Preview failed' : 'Copy failed'))
    } finally {
      setBusy(false)
    }
  }

  return {
    sourceProject,
    setSourceProject: (project: string) => {
      setSourceProject(project)
      invalidate()
    },
    sourceEnvironments,
    sourceEnv,
    setSourceEnv: (env: string) => {
      setSourceEnv(env)
      invalidate()
    },
    mode,
    setMode: (next: ScopeCopyMode) => {
      setMode(next)
      invalidate()
    },
    prefer,
    setPrefer: (next: ScopeCopyPrefer) => {
      setPrefer(next)
      invalidate()
    },
    from,
    canRead,
    canWrite,
    canReplace,
    allowed: canRead && canWrite && (mode === 'merge' || canReplace),
    preview,
    applied,
    /** Whichever of the two is current — applied wins, because it happened. */
    result: applied || preview,
    busy,
    error,
    run,
  }
}
