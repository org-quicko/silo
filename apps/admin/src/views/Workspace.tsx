import { Button } from '../components/buttons/Button'
import { useEffect, useState } from 'react'
import { Claims } from '@silo/shared/claims'
import { Routes } from '../router/routes'
import { router } from '../router/router'
import { DEFAULT_LIST_QUERY, type ListQuery } from '../router/list-query'
import type { ServerRoute } from '../router/route'
import type { Server } from './servers/server'
import { ServerManager } from './servers/ServerManager'
import type { ScopeRef } from '../api/types/scope-ref'
import { ScopeMemory } from '../utils/scope-memory'
import { CollectionVisits } from '../utils/collection-visits'
import { CommandPalette } from './search/CommandPalette'
import type { PaletteSeed } from './search/palette-seed'
import { Sidebar } from './shell/Sidebar'
import { TopBar } from './shell/TopBar'
import { SmartSearch } from './search/SmartSearch'
import { EntriesView } from './entries/Entries'
import { SchemaEditorView } from './schema/SchemaEditor'
import { EntryForm } from './entries/EntryForm'
import { MediaLibraryView } from './media/MediaLibrary'
import styles from './Workspace.module.css'
import { buildSessionBadge } from './shell/build-session-badge'
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
  // Seeds the instance overlay when the smart bar's chip is off (or names a
  // collection this page can't show in-table results for) — `null` closes
  // it. `⌘K`/`/` are handled by whichever `SmartSearch` is mounted on the
  // current page, not here; every page has one, so there is always a target.
  const [palette, setPalette] = useState<PaletteSeed | null>(null)

  // The settings shell's PROJECT/ENVIRONMENT groups need a scope even on its
  // unscoped pages (keys, connection); this is where one is known for certain.
  useEffect(() => {
    ScopeMemory.set(serverId, scope)
  }, [serverId, scope.project, scope.env])

  const session = useWorkspaceSession(url, apiKey, scope, onDisconnect)
  const { ready, sessionInfo, claims, version, collections, counts, totalEntries } = session

  useRouteGuard(ready, route, claims, collections, serverId, scope)

  // A null id means "new entry", which is a form with nothing to fetch.
  const entryId = route.view === 'entry' ? route.entryId : null
  const entry = useDeepLinkedEntry(
    url,
    apiKey,
    scope,
    serverId,
    route.view === 'entry' ? route.collection : null,
    entryId,
  )


  const activeName = 'collection' in route ? route.collection : null
  const activeCollection = collections.find((c) => c.name === activeName) ?? null

  // Backs the `@`-mention popup's "sorted by recency of visit" rule
  // (handoff 1f). Every way of landing on a collection counts as a visit —
  // a sidebar click as much as a mention commit — so this lives where every
  // route change already passes through, not inside the search bar itself.
  useEffect(() => {
    if (!activeCollection) return
    CollectionVisits.record(serverId, scope.project, scope.env, activeCollection.name)
  }, [serverId, scope.project, scope.env, activeCollection?.name])

  if (!ready) {
    return <div className="center-wrap">Connecting to {server.name}…</div>
  }

  const sessionBadge = buildSessionBadge(sessionInfo, scope)

  // What every `SmartSearch` needs to offer the `@`-mention popup: the same
  // list the sidebar shows, with each collection's schema alongside its name
  // so a query can match a *field* name too (handoff 1f).
  const smartCollections = collections.map((c) => ({ name: c.name, count: counts[c.name] ?? null, schema: c.schema }))

  const goToEntries = (name: string) => router.navigate(Routes.entries(serverId, scope.project, scope.env, name))
  // What the smart bar's scope chip does when it names a collection other
  // than the one on screen: leave, carrying whatever text was still typed.
  const goToCollectionSearch = (name: string, q: string) =>
    router.navigate(Routes.entries(serverId, scope.project, scope.env, name, { ...DEFAULT_LIST_QUERY, q }))
  const afterCountsChange = () => session.refreshCounts()

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
          <MediaLibraryView
            serverId={serverId}
            scope={scope}
            collections={smartCollections}
            url={url}
            apiKey={apiKey}
            session={sessionBadge}
            claims={claims}
            initialQuery={route.q}
            onOpenPalette={setPalette}
            onNavigateToCollection={goToCollectionSearch}
          />
        )}

        {route.view === 'schema' && (() => {
          const backTo = activeCollection
            ? Routes.entries(serverId, scope.project, scope.env, activeCollection.name)
            : Routes.collections(serverId, scope.project, scope.env)
          return (
            <SchemaEditorView
              key={route.collection ?? 'new'}
              serverId={serverId}
              collection={activeCollection}
              collections={collections}
              url={url}
              apiKey={apiKey}
              scope={scope}
              claims={claims}
              session={sessionBadge}
              backTo={backTo}
              entryCount={activeCollection ? counts[activeCollection.name] ?? null : null}
              onOpenPalette={setPalette}
              onNavigateToCollection={goToCollectionSearch}
              onSaved={(name) => {
                session.refreshCollections().then(() => goToEntries(name))
              }}
              onCancel={() => router.navigate(backTo)}
              onDeleted={() => {
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
            collections={collections}
            url={url}
            apiKey={apiKey}
            scope={scope}
            entry={entry}
            claims={claims}
            session={sessionBadge}
            backTo={Routes.entries(serverId, scope.project, scope.env, activeCollection.name)}
            onOpenPalette={setPalette}
            onNavigateToCollection={goToCollectionSearch}
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
            serverId={serverId}
            collection={activeCollection}
            collections={smartCollections}
            url={url}
            apiKey={apiKey}
            scope={scope}
            claims={claims}
            session={sessionBadge}
            query={route.query}
            onQueryChange={(next: ListQuery, replace?: boolean) =>
              router.navigate(Routes.entries(serverId, scope.project, scope.env, activeCollection.name, next), { replace })
            }
            onEditSchema={() => router.navigate(Routes.schema(serverId, scope.project, scope.env, activeCollection.name))}
            onNewEntry={() => router.navigate(Routes.newEntry(serverId, scope.project, scope.env, activeCollection.name))}
            onEditEntry={(e) => router.navigate(Routes.entry(serverId, scope.project, scope.env, activeCollection.name, e.id))}
            onChanged={afterCountsChange}
            onOpenPalette={setPalette}
            onNavigateToCollection={goToCollectionSearch}
          />
        )}

        {route.view === 'collections' && collections.length === 0 && (
          <>
            <TopBar
              search={
                <SmartSearch
                  serverId={serverId}
                  scope={scope}
                  collection={null}
                  collections={smartCollections}
                  onNavigateToCollection={goToCollectionSearch}
                  onOpenPalette={setPalette}
                />
              }
              session={sessionBadge}
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

      {palette && (
        <CommandPalette
          serverId={serverId}
          url={url}
          apiKey={apiKey}
          scope={scope}
          claims={claims}
          initialQuery={palette.q}
          reach={palette.collection ? { collection: palette.collection } : undefined}
          onNavigate={(href) => router.navigate(href)}
          onClose={() => setPalette(null)}
        />
      )}

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
