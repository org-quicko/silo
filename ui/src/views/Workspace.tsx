import { Button } from '../components/Button'
import { useCallback, useEffect, useState } from 'react'
import { Claims } from '@silo/shared/claims'
import { api } from '../api/api-client'
import type { Collection } from '../api/types/collection'
import type { Entry } from '../api/types/entry'
import type { SessionInfo } from '../api/types/session-info'
import { Routes } from '../router/routes'
import { router } from '../router/router'
import type { ListQuery } from '../router/list-query'
import type { ServerRoute } from '../router/route'
import type { Server } from './servers/server'
import { ServerManager } from './servers/ServerManager'
import type { ScopeRef } from '../api/types/scope-ref'
import { ScopeMemory } from '../utils/scope-memory'
import { Sidebar } from './shell/Sidebar'
import { TopBar } from './shell/TopBar'
import { EntriesView } from './entries/Entries'
import { SchemaEditorView } from './schema/SchemaEditor'
import { EntryForm } from './entries/EntryForm'
import { MediaLibraryView } from './media/MediaLibrary'
import styles from './Workspace.module.css'

interface Props {
  server: Server
  servers: Server[]
  route: ServerRoute
  onDisconnect: () => void
  onApiKeyChange: (apiKey: string) => void
  onAddServer: (server: Server) => void
}

/** The connected two-pane shell. Mounted per server (keyed on id by App). */
export function Workspace({
  server,
  servers,
  route,
  onDisconnect,
  onApiKeyChange: _onApiKeyChange,
  onAddServer,
}: Props) {
  const { id: serverId, url, apiKey } = server
  const scope: ScopeRef = { project: route.project, env: route.env }

  const [showServerBrowser, setShowServerBrowser] = useState(false)

  // The settings shell's PROJECT/ENVIRONMENT groups need a scope even on its
  // unscoped pages (keys, connection); this is where one is known for certain.
  useEffect(() => {
    ScopeMemory.set(serverId, scope)
  }, [serverId, scope.project, scope.env])

  const [ready, setReady] = useState(false)
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null)
  const [version, setVersion] = useState('')
  const [collections, setCollections] = useState<Collection[]>([])
  const [counts, setCounts] = useState<Record<string, number | null>>({})

  const loadCounts = useCallback(
    async (cols: Collection[]) => {
      const totals = await Promise.all(
        cols.map(async (c) => {
          try {
            const r = await api.listEntries(url, apiKey, scope, c.name, { limit: 1 })
            return [c.name, r.total] as const
          } catch {
            return [c.name, null] as const
          }
        }),
      )
      setCounts(Object.fromEntries(totals))
    },
    [url, apiKey, scope.project, scope.env],
  )

  const refreshCollections = useCallback(async () => {
    const cols = await api.listCollections(url, apiKey, scope)
    setCollections(cols)
    loadCounts(cols)
    return cols
  }, [url, apiKey, scope.project, scope.env, loadCounts])

  // Verify the stored key, then load the collection list this shell navigates.
  useEffect(() => {
    let alive = true
    setReady(false)
    const init = async () => {
      try {
        const verified = await api.verify(url, apiKey)
        if (!alive) return
        if (!verified.ok) {
          onDisconnect()
          return
        }
        if (!verified.session) {
          onDisconnect()
          return
        }
        setSessionInfo(verified.session)
        try {
          const h = await api.health(url)
          if (alive) setVersion(h.version || '')
        } catch {
          /* health is unauthenticated; ignore transient failure */
        }
        await refreshCollections()
      } catch {
        if (alive) onDisconnect()
      } finally {
        if (alive) setReady(true)
      }
    }
    init()
    return () => {
      alive = false
    }
  }, [url, apiKey, refreshCollections, onDisconnect])

  // Resolve routes that can only be settled once the collections are known:
  // the collection index, links to collections that no longer exist, and
  // claim-protected areas reached with a key that cannot use them.
  useEffect(() => {
    if (!ready) return
    const claims = sessionInfo?.claims || []
    const blocked =
      (route.view === 'media' && !Claims.has(claims, Claims.MediaRead)) ||
      (route.view === 'schema' && route.collection === null && !Claims.hasAnyCollectionPermission(claims, Claims.CollectionCreate, scope.project, scope.env)) ||
      (route.view === 'schema' && route.collection !== null && !Claims.has(claims, Claims.collection(scope.project, scope.env, route.collection, Claims.CollectionSchemaUpdate)))
    if (blocked) {
      router.navigate(Routes.collections(serverId, scope.project, scope.env), { replace: true })
      return
    }
    if (route.view === 'collections') {
      if (collections.length) router.navigate(Routes.entries(serverId, scope.project, scope.env, collections[0].name), { replace: true })
      return
    }
    const name = 'collection' in route ? route.collection : null
    if (name && !collections.some((c) => c.name === name)) {
      router.navigate(Routes.collections(serverId, scope.project, scope.env), { replace: true })
    }
  }, [ready, sessionInfo, route, collections, serverId, scope.project, scope.env])

  // A deep link to an entry carries only its id, so the entry is fetched here
  // rather than handed down from the list.
  const entryCollection = route.view === 'entry' ? route.collection : null
  const entryId = route.view === 'entry' ? route.entryId : null
  const [entry, setEntry] = useState<Entry | null>(null)

  useEffect(() => {
    setEntry(null)
    if (!entryCollection || !entryId) return
    let alive = true
    api
      .getEntry(url, apiKey, scope, entryCollection, entryId)
      .then((e) => {
        if (alive) setEntry(e)
      })
      .catch(() => {
        // Stale or bad id — fall back to the collection it belongs to.
        if (alive) router.navigate(Routes.entries(serverId, scope.project, scope.env, entryCollection), { replace: true })
      })
    return () => {
      alive = false
    }
  }, [url, apiKey, scope.project, scope.env, serverId, entryCollection, entryId])

  if (!ready) {
    return <div className="center-wrap">Connecting to {server.name}…</div>
  }

  const activeName = 'collection' in route ? route.collection : null
  const activeCollection = collections.find((c) => c.name === activeName) ?? null
  const claims = sessionInfo?.claims || []
  const session = `${sessionInfo?.label || Claims.label(claims)} · ${server.name}`
  const totalEntries = collections.length
    ? collections.reduce((sum, c) => sum + (counts[c.name] ?? 0), 0)
    : null

  const goToEntries = (name: string) => router.navigate(Routes.entries(serverId, scope.project, scope.env, name))
  const afterCountsChange = () => loadCounts(collections)

  return (
    <div className={styles.shell}>
      <Sidebar
        serverId={serverId}
        collections={collections.map((c) => ({ name: c.name, count: counts[c.name] ?? null }))}
        activeCollection={route.view === 'entries' || route.view === 'entry' ? activeName : null}
        activePanel={route.view === 'media' ? 'media' : null}
        claims={claims}
        version={version}
        instanceLabel={server.name}
        totalEntries={totalEntries}
        url={url}
        apiKey={apiKey}
        scope={scope}
        onOpenServerBrowser={() => setShowServerBrowser(true)}
      />

      <main className={styles.main}>
        {route.view === 'media' && (
          <MediaLibraryView url={url} apiKey={apiKey} session={session} claims={claims} />
        )}

        {route.view === 'schema' && (() => {
          const backTo = activeCollection
            ? Routes.entries(serverId, scope.project, scope.env, activeCollection.name)
            : Routes.collections(serverId, scope.project, scope.env)
          return (
            <SchemaEditorView
              key={route.collection ?? 'new'}
              collection={activeCollection}
              collections={collections}
              url={url}
              apiKey={apiKey}
              scope={scope}
              claims={claims}
              session={session}
              backTo={backTo}
              onSaved={(name) => {
                refreshCollections().then(() => goToEntries(name))
              }}
              onCancel={() => router.navigate(backTo)}
            />
          )
        })()}

        {route.view === 'entry' && activeCollection && (entryId === null || entry) && (
          <EntryForm
            key={entryId ?? 'new'}
            collection={activeCollection}
            collections={collections}
            url={url}
            apiKey={apiKey}
            scope={scope}
            entry={entry}
            claims={claims}
            session={session}
            backTo={Routes.entries(serverId, scope.project, scope.env, activeCollection.name)}
            onSaved={() => {
              afterCountsChange()
              goToEntries(activeCollection.name)
            }}
            onCancel={() => goToEntries(activeCollection.name)}
            onDeleted={() => {
              afterCountsChange()
              goToEntries(activeCollection.name)
            }}
          />
        )}

        {route.view === 'entry' && entryId !== null && !entry && (
          <div className="center-wrap">Loading entry…</div>
        )}

        {route.view === 'entries' && activeCollection && (
          <EntriesView
            key={activeCollection.name}
            collection={activeCollection}
            url={url}
            apiKey={apiKey}
            scope={scope}
            claims={claims}
            session={session}
            query={route.query}
            onQueryChange={(next: ListQuery, replace?: boolean) =>
              router.navigate(Routes.entries(serverId, scope.project, scope.env, activeCollection.name, next), { replace })
            }
            onEditSchema={() => router.navigate(Routes.schema(serverId, scope.project, scope.env, activeCollection.name))}
            onNewEntry={() => router.navigate(Routes.newEntry(serverId, scope.project, scope.env, activeCollection.name))}
            onEditEntry={(e) => router.navigate(Routes.entry(serverId, scope.project, scope.env, activeCollection.name, e.id))}
            onChanged={afterCountsChange}
          />
        )}

        {route.view === 'collections' && collections.length === 0 && (
          <>
            <TopBar
              crumbs={[{ label: server.name }]}
              session={session}
            />
            <div className="content">
              <div className={`center-wrap ${styles.emptyCollections}`}>
                <span>No collections yet in {scope.project}/{scope.env}.</span>
                {Claims.hasAnyCollectionPermission(claims, Claims.CollectionCreate, scope.project, scope.env) && (
                  <Button
                     variant="primary"
                    onClick={() => router.navigate(Routes.schema(serverId, scope.project, scope.env, null))}
                  >
                    Create a collection
                  </Button>
                )}
              </div>
            </div>
          </>
        )}
      </main>

      {showServerBrowser && (
        <ServerManager
          servers={servers}
          initialServerId={server.id}
          initialProject={scope.project}
          initialEnv={scope.env}
          onConnect={(id, project, env) => {
            setShowServerBrowser(false)
            router.navigate(Routes.collections(id, project, env))
          }}
          onAddServer={onAddServer}
          onOpenStatus={(id) => {
            setShowServerBrowser(false)
            router.navigate(Routes.serverSettings(id, 'connection'))
          }}
          onClose={() => setShowServerBrowser(false)}
        />
      )}
    </div>
  )
}
