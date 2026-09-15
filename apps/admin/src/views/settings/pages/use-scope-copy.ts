import { useEffect, useRef, useState } from 'react'
import { Claims } from '@silo/shared/claims'
import type { CollectionPermission } from '@silo/shared/collection-permission'
import type { CollectionSummary } from '../../../api/types/collection-summary'
import type { CopyScopeSelection } from '../../../api/types/copy-scope-options'
import type { Entry } from '../../../api/types/entry'
import type { ImportResult } from '../../../api/types/import-result'
import type { ScopeRef } from '../../../api/types/scope-ref'
import { api } from '../../../api/silo-api'
import type { Server } from '../../servers/server'
import { ScopeCopySelection } from './scope-copy-selection'
import { useScopeCopySearch } from './use-scope-copy-search'

export type ScopeCopyMode = 'merge' | 'replace'
export type ScopeCopyPrefer = '' | 'local' | 'remote'
const PreviewLimit = 25

/** Owns a source-to-fixed-destination copy form, including guarded async reads. */
export function useScopeCopy(server: Server, destination: ScopeRef, claims: string[]) {
  const [sourceProject, setSourceProject] = useState(destination.project)
  const [sourceEnvironments, setSourceEnvironments] = useState<string[]>([])
  const [sourceEnv, setSourceEnv] = useState('')
  const [mode, setModeState] = useState<ScopeCopyMode>('merge')
  const [prefer, setPreferState] = useState<ScopeCopyPrefer>('')
  const [customize, setCustomizeState] = useState(false)
  const [collections, setCollections] = useState<CollectionSummary[]>([])
  const [selection, setSelection] = useState<CopyScopeSelection[]>([])
  const [selectedEntries, setSelectedEntries] = useState<Record<string, Entry>>({})
  const [inspected, setInspected] = useState<Entry | null>(null)
  const [preview, setPreview] = useState<ImportResult | null>(null)
  const [applied, setApplied] = useState<ImportResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const alive = useRef(true)
  const environmentsRequest = useRef(0)
  const collectionsRequest = useRef(0)
  const operationRequest = useRef(0)
  const inspectRequest = useRef(0)
  const inFlight = useRef(false)
  const configurationRef = useRef('')
  const from: ScopeRef | null = sourceEnv ? { project: sourceProject, env: sourceEnv } : null
  const configuration = `${server.id}/${server.url}/${server.apiKey}/${destination.project}/${destination.env}/${sourceProject}/${sourceEnv}`
  const invalidate = () => {
    operationRequest.current++
    inspectRequest.current++
    setBusy(false)
    setPreview(null)
    setApplied(null)
    setError('')
    setInspected(null)
  }

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; environmentsRequest.current++; collectionsRequest.current++; operationRequest.current++ }
  }, [])

  useEffect(() => { configurationRef.current = configuration }, [configuration])

  useEffect(() => {
    invalidate()
    environmentsRequest.current++
    collectionsRequest.current++
    setSourceProject(destination.project)
    setSourceEnvironments([])
    setSourceEnv('')
    setCollections([])
    setSelection([])
  }, [server.id, server.url, server.apiKey, destination.project, destination.env])

  useEffect(() => {
    const ticket = ++environmentsRequest.current
    api.projects.listEnvironments(server.url, server.apiKey, sourceProject).then((records) => {
      if (!alive.current || ticket !== environmentsRequest.current) return
      const eligible = records.map((record) => record.name).filter((env) => sourceProject !== destination.project || env !== destination.env)
      setSourceEnvironments(eligible)
      setSourceEnv((current) => eligible.includes(current) ? current : eligible[0] || '')
    }).catch((caught: unknown) => {
      if (!alive.current || ticket !== environmentsRequest.current) return
      setSourceEnvironments([]); setSourceEnv(''); setError(caught instanceof Error ? caught.message : 'Failed to load environments')
    })
  }, [server.url, server.apiKey, sourceProject, destination.project, destination.env])

  useEffect(() => {
    const ticket = ++collectionsRequest.current
    setSelection([]); setSelectedEntries({}); setCollections([]); setInspected(null)
    if (!from) return
    api.collections.list(server.url, server.apiKey, from).then((items) => {
      if (alive.current && ticket === collectionsRequest.current) setCollections(items)
    }).catch((caught: unknown) => {
      if (alive.current && ticket === collectionsRequest.current) setError(caught instanceof Error ? caught.message : 'Failed to load collections')
    })
  }, [server.url, server.apiKey, sourceProject, sourceEnv])

  const scopeSearch = useScopeCopySearch(server, from, collections)

  const hasCollectionAuthority = (scope: ScopeRef, collection: string, permissions: readonly CollectionPermission[]) => permissions.every((permission) => Claims.has(claims, Claims.collection(scope.project, scope.env, collection, permission)))
  const canRead = !!from && Claims.hasScopeWide(claims, Claims.ScopeCopyReadPermissions, from.project, from.env)
  const canWrite = Claims.hasScopeWide(claims, Claims.ScopeCopyWritePermissions, destination.project, destination.env)
  const canReplace = Claims.hasScopeWide(claims, Claims.ScopeCopyReplacePermissions, destination.project, destination.env)
  const selectedAllowed = !!from && selection.every((item) => hasCollectionAuthority(from, item.collection, Claims.ScopeCopyReadPermissions) && hasCollectionAuthority(destination, item.collection, Claims.ScopeCopyWritePermissions) && (mode === 'merge' || hasCollectionAuthority(destination, item.collection, Claims.ScopeCopyReplacePermissions)))
  const allowed = customize ? selection.length > 0 && selectedAllowed : canRead && canWrite && (mode === 'merge' || canReplace)
  const selectionValid = !customize || selection.length > 0 && selection.every((item) => item.entryIds === undefined || item.entryIds.length > 0)

  const run = async (dryRun: boolean, detailOffset = 0) => {
    if (inFlight.current || !from || !allowed || !selectionValid) return
    inFlight.current = true
    const ticket = ++operationRequest.current
    const runConfiguration = configuration
    const snapshot = JSON.stringify({ server: server.url, source: from, destination, mode, prefer, customize, selection })
    setBusy(true); setError('')
    if (dryRun && !preview) { setPreview(null); setApplied(null) }
    if (dryRun && preview) setInspected(null)
    try {
      const result = await api.transfer.copyScope(server.url, server.apiKey, destination, { from, mode, prefer, dryRun, selection: customize ? selection : undefined, detailOffset: dryRun ? detailOffset : undefined, detailLimit: dryRun ? PreviewLimit : undefined })
      if (!alive.current || ticket !== operationRequest.current || configurationRef.current !== runConfiguration || snapshot !== JSON.stringify({ server: server.url, source: from, destination, mode, prefer, customize, selection })) return
      if (dryRun) setPreview(result); else { setApplied(result); setPreview(null) }
    } catch (caught: unknown) {
      if (alive.current && ticket === operationRequest.current) setError(caught instanceof Error ? caught.message : dryRun ? 'Preview failed' : 'Copy failed')
    } finally { inFlight.current = false; if (alive.current && ticket === operationRequest.current) setBusy(false) }
  }

  return {
    sourceProject, sourceEnvironments, sourceEnv, mode, prefer, customize, collections, selection, from, canRead, canWrite, canReplace, allowed, selectionValid, preview, applied, result: applied || preview, busy, error, scopeSearch, selectedEntries, inspected,
    setSourceProject: (project: string) => {
      invalidate()
      environmentsRequest.current++
      collectionsRequest.current++
      setSourceProject(project)
      setSourceEnvironments([])
      setSourceEnv('')
      setCollections([])
      setSelection([])
    },
    setSourceEnv: (env: string) => { setSourceEnv(env); invalidate() },
    setMode: (next: ScopeCopyMode) => { setModeState(next); invalidate() },
    setPrefer: (next: ScopeCopyPrefer) => { setPreferState(next); invalidate() },
    setCustomize: (next: boolean) => { setCustomizeState(next); if (!next) setSelection([]); invalidate() },
    setScopeQuery: scopeSearch.setQuery,
    addCollection: (collection: string) => {
      setSelection((current) => ScopeCopySelection.addCollection(current, collection))
      invalidate()
    },
    addEntry: (entry: Entry) => {
      setModeState('merge')
      setSelectedEntries((current) => ({ ...current, [`${entry.collection}/${entry.id}`]: entry }))
      setSelection((current) => ScopeCopySelection.addEntry(current, entry.collection, entry.id))
      invalidate()
    },
    removeCollection: (collection: string) => { setSelection((current) => ScopeCopySelection.removeCollection(current, collection)); invalidate() },
    removeEntry: (collection: string, id: string) => {
      setSelectedEntries((current) => { const next = { ...current }; delete next[`${collection}/${id}`]; return next })
      setSelection((current) => ScopeCopySelection.removeEntry(current, collection, id))
      invalidate()
    },
    toggleCollection: (collection: string) => { setSelection((current) => current.some((item) => item.collection === collection) ? current.filter((item) => item.collection !== collection) : [...current, { collection }]); invalidate() },
    subsetSelected: (collection: string, id: string) => selection.find((item) => item.collection === collection)?.entryIds?.includes(id) || false,
    inspectEntry: async (collection: string, id: string) => {
      if (!from) return
      const ticket = ++inspectRequest.current
      const source = from
      const runConfiguration = configuration
      try {
        const entry = await api.entries.get(server.url, server.apiKey, source, collection, id)
        if (alive.current && ticket === inspectRequest.current && configurationRef.current === runConfiguration) setInspected(entry)
      } catch (caught) {
        if (alive.current && ticket === inspectRequest.current) setError(caught instanceof Error ? caught.message : 'Could not load source entry')
      }
    },
    clearInspected: () => setInspected(null),
    run,
  }
}
