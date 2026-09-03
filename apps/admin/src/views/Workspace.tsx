import { Button } from '../components/buttons/Button'
import { useEffect, useState } from 'react'
import { Claims } from '@silo/shared/claims'
import { LoadingState } from '../components/feedback/LoadingState'
import { Routes } from '../router/routes'
import { router } from '../router/router'
import type { ListQuery } from '../router/list-query'
import type { ServerRoute } from '../router/route'
import type { Server } from './servers/server'
import { ServerManager } from './servers/ServerManager'
import type { ScopeRef } from '../api/types/scope-ref'
import { ScopeMemory } from '../utils/scope-memory'
import { CollectionVisits } from '../utils/collection-visits'
import { store } from '../store/store'
import { StoreKeys } from '../store/store-keys'
import { Sidebar } from './shell/Sidebar'
import { ShortcutsDialog } from './shell/ShortcutsDialog'
import { TopBar } from './shell/TopBar'
import { SmartSearch } from './search/SmartSearch'
import { EntriesView } from './entries/Entries'
import { SchemaEditorView } from './schema/SchemaEditor'
import { EntryForm } from './entries/EntryForm'
import { MediaLibraryView } from './media/MediaLibrary'
import styles from './Workspace.module.css'
import { buildSessionBadge } from './shell/build-session-badge'
import { useCollectionSchema } from '../store/use-collection-schema'
import { useShellShortcuts } from './shell/use-shell-shortcuts'
import { useDeepLinkedEntry } from './use-deep-linked-entry'
import { useRouteGuard } from './use-route-guard'
import { useWorkspaceSession } from './use-workspace-session'

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
  const [showShortcuts, setShowShortcuts] = useState(false)

  // Both belong to the shell rather than to a page: the shortcut list covers
  // the whole app, and Settings is a detour from wherever you are. The sidebar
  // carries the same two as items.
  useShellShortcuts(Routes.projectSettings(serverId, scope.project, 'general'), () =>
    setShowShortcuts(true),
  )

  // The settings shell's PROJECT/ENVIRONMENT groups need a scope even on its
  // unscoped pages (keys, connection); this is where one is known for certain.
  useEffect(() => {
    ScopeMemory.set(serverId, scope)
  }, [serverId, scope.project, scope.env])

  const session = useWorkspaceSession(serverId, url, apiKey, scope, onDisconnect)
  const { ready, sessionInfo, claims, version, collections } = session

  useRouteGuard(ready, route, claims, collections, serverId, scope)

  // A null id means "new entry", which is a form with nothing to fetch.
  const entryId = route.view === 'entry' ? route.entryId : null
  const entry = useDeepLinkedEntry(
    serverId,
    url,
    apiKey,
    scope,
    route.view === 'entry' ? route.collection : null,
    entryId,
  )


  const activeName = 'collection' in route ? route.collection : null

  // The one schema this route draws, and no more (D54). The server bundles a
  // collection's `silo://` refs into its own `$defs` on the way out, so the
  // document is self-contained and the entry form needs nothing else. One store
  // key per collection, so the list warms it and every entry opened from that
  // list is a cache read.
  const activeCollection = useCollectionSchema(serverId, url, apiKey, scope, activeName).value
  /** The listing's own row for the same collection: its count, without asking
   *  for it again. */
  const activeSummary = collections.find((c) => c.name === activeName) ?? null

  // Backs the `@`-mention popup's "sorted by recency of visit" rule
  // (handoff 1f). Every way of landing on a collection counts as a visit —
  // a sidebar click as much as a mention commit — so this lives where every
  // route change already passes through, not inside the search bar itself.
  useEffect(() => {
    if (!activeName) return
    CollectionVisits.record(serverId, scope.project, scope.env, activeName)
  }, [serverId, scope.project, scope.env, activeName])

  if (!ready) {
    return <LoadingState fill size="lg" message={`Connecting to ${server.name}…`} />
  }

  const sessionBadge = buildSessionBadge(sessionInfo, scope)

  // What every `SmartSearch` needs to offer the `@`-mention popup: the same
  // list the sidebar shows. It matches a *field* name too (handoff 1f), and
  // fetches the schemas for that itself, the first time a mention is typed.
  const smartCollections = collections.map((c) => ({ name: c.name, count: c.entries }))

  const goToEntries = (name: string) => router.navigate(Routes.entries(serverId, scope.project, scope.env, name))

  /** A write invalidates every page and entry the store holds for that
   *  collection, so the next read asks again rather than showing what was true
   *  before the write. */
  const afterEntriesChange = (name: string) => {
    store.invalidatePrefix(StoreKeys.collection(serverId, scope, name))
    // The listing carries the counts now, so a write invalidates that too.
    session.refreshCollections()
  }

  return (
    <div className={styles.shell}>
      <Sidebar
        serverId={serverId}
        collections={collections.map((c) => ({ name: c.name, count: c.entries }))}
        activeCollection={route.view === 'entries' || route.view === 'entry' ? activeName : null}
        activePanel={route.view === 'media' ? 'media' : null}
        claims={claims}
        version={version}
        instanceLabel={server.name}
        session={sessionBadge}
        url={url}
        apiKey={apiKey}
        scope={scope}
        onOpenServerBrowser={() => setShowServerBrowser(true)}
        onShowShortcuts={() => setShowShortcuts(true)}
      />

      <main className={styles.main}>
        {route.view === 'media' && (
          <MediaLibraryView
            serverId={serverId}
            scope={scope}
            collections={smartCollections}
            url={url}
            apiKey={apiKey}
            claims={claims}
            initialQuery={route.q}
          />
        )}

        {route.view === 'schema' && route.collection !== null && !activeCollection && (
          <LoadingState message={`Loading ${route.collection}…`} />
        )}

        {route.view === 'schema' && (route.collection === null || activeCollection) && (() => {
          const backTo = activeCollection
            ? Routes.entries(serverId, scope.project, scope.env, activeCollection.name)
            : Routes.collections(serverId, scope.project, scope.env)
          return (
            <SchemaEditorView
              key={route.collection ?? 'new'}
              serverId={serverId}
              collection={activeCollection}
              collections={smartCollections}
              url={url}
              apiKey={apiKey}
              scope={scope}
              claims={claims}
              backTo={backTo}
              entryCount={activeSummary ? activeSummary.entries : null}
              onSaved={(name) => {
                session.refreshCollections().then(() => goToEntries(name))
              }}
              onCancel={() => router.navigate(backTo)}
              onDeleted={() => {
                if (activeCollection) {
                  store.invalidatePrefix(StoreKeys.collection(serverId, scope, activeCollection.name))
                }
                session.refreshCollections().then((remaining) => {
                  const next = remaining[0]
                  router.navigate(next
                    ? Routes.entries(serverId, scope.project, scope.env, next.name)
                    : Routes.collections(serverId, scope.project, scope.env))
                })
              }}
            />
          )
        })()}

        {route.view === 'entry' && activeCollection && (entryId === null || entry) && (
          <EntryForm
            key={entryId ?? 'new'}
            serverId={serverId}
            collection={activeCollection}
            collections={smartCollections}
            url={url}
            apiKey={apiKey}
            scope={scope}
            entry={entry}
            claims={claims}
            backTo={Routes.entries(serverId, scope.project, scope.env, activeCollection.name)}
            onSaved={() => {
              afterEntriesChange(activeCollection.name)
              goToEntries(activeCollection.name)
            }}
            onCancel={() => goToEntries(activeCollection.name)}
            onDeleted={() => {
              afterEntriesChange(activeCollection.name)
              goToEntries(activeCollection.name)
            }}
          />
        )}

        {route.view === 'entry' && (!activeCollection || (entryId !== null && !entry)) && (
          <LoadingState message="Loading entry…" />
        )}

        {route.view === 'entries' && !activeCollection && (
          <LoadingState message={`Loading ${activeName}…`} />
        )}

        {route.view === 'entries' && activeCollection && (
          <EntriesView
            key={activeCollection.name}
            serverId={serverId}
            collection={activeCollection}
            collections={smartCollections}
            url={url}
            apiKey={apiKey}
            scope={scope}
            claims={claims}
            query={route.query}
            onQueryChange={(next: ListQuery, replace?: boolean) =>
              router.navigate(Routes.entries(serverId, scope.project, scope.env, activeCollection.name, next), { replace })
            }
            onEditSchema={() => router.navigate(Routes.schema(serverId, scope.project, scope.env, activeCollection.name))}
            onNewEntry={() => router.navigate(Routes.newEntry(serverId, scope.project, scope.env, activeCollection.name))}
            onEditEntry={(e) => router.navigate(Routes.entry(serverId, scope.project, scope.env, activeCollection.name, e.id))}
            onChanged={() => afterEntriesChange(activeCollection.name)}
          />
        )}

        {route.view === 'collections' && collections.length === 0 && (
          <>
            <TopBar
              search={
                <SmartSearch
                  serverId={serverId}
                  url={url}
                  apiKey={apiKey}
                  scope={scope}
                  claims={claims}
                  collections={smartCollections}
                />
              }
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

      {showShortcuts && <ShortcutsDialog onClose={() => setShowShortcuts(false)} />}

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
