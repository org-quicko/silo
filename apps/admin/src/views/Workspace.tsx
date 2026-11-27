import { Button } from '../components/buttons/Button'
import { useEffect, useRef, useState } from 'react'
import { Claims } from '@silo/shared/claims'
import { LoadingState } from '../components/feedback/LoadingState'
import { Routes } from '../router/routes'
import { router } from '../router/router'
import type { ListQuery } from '../router/list-query'
import type { ServerRoute } from '../router/route'
import type { Server } from './servers/server'
import { ServerManager } from './servers/ServerManager'
import { api } from '../api/silo-api'
import type { ScopeRef } from '../api/types/scope-ref'
import { ScopeMemory } from '../utils/scope-memory'
import { CollectionVisits } from '../utils/collection-visits'
import { store } from '../store/store'
import { StoreKeys } from '../store/store-keys'
import { useScopeMutationVersion } from '../store/use-scope-mutation'
import { Sidebar } from './shell/Sidebar'
import { TopBar } from './shell/TopBar'
import { SmartSearch } from './search/SmartSearch'
import { EntriesView } from './entries/Entries'
import { ListReturnMemory } from './entries/list-return-memory'
import { SchemaEditorView } from './schema/SchemaEditor'
import { SchemaRedirectGuard, type PendingSchemaScope } from './schema/schema-redirect-guard'
import { EntryForm } from './entries/EntryForm'
import { MediaLibraryView } from './media/MediaLibrary'
import { Trash } from './trash/Trash'
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
  onUpdateServer: (server: Server) => void
  onForgetServer: (serverId: string) => void
}

/** The connected two-pane shell. Mounted per server (keyed on id by App). */
export function Workspace({
  server,
  servers,
  route,
  onDisconnect,
  onApiKeyChange: _onApiKeyChange,
  onAddServer,
  onUpdateServer,
  onForgetServer,
}: Props) {
  const { id: serverId, url, apiKey } = server
  const scope: ScopeRef = 'project' in route
    ? { project: route.project, env: route.env }
    : (ScopeMemory.get(serverId) ?? { project: 'default', env: 'production' })

  const [showServerBrowser, setShowServerBrowser] = useState(false)
  const [epochAtSessionStart] = useState(() => store.sessionEpoch())
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const scopeKey = StoreKeys.scope(serverId, scope)
  const mutationVersion = useScopeMutationVersion(serverId, scope)
  const entriesRefresh = String(mutationVersion)

  const [pendingSchemaRedirect, setPendingSchemaRedirect] =
    useState<PendingSchemaScope | null>(null)
  const pendingSchemaRefreshRef = useRef<Promise<unknown> | null>(null)
  const pendingDeleteRefreshRef = useRef<Promise<typeof collections> | null>(null)
  const nextSchemaMutationIdRef = useRef(0)
  const activeNavId = router.getNavId()
  const activePendingSchemaRedirect = SchemaRedirectGuard.matches(
    pendingSchemaRedirect,
    route,
    serverId,
    scope,
    activeNavId,
  )
    ? pendingSchemaRedirect
    : null

  // Both belong to the shell rather than to a page: the shortcut list covers
  // the whole app, and Settings is a detour from wherever you are.
  useShellShortcuts(Routes.projectSettings(serverId, scope.project, 'general'))

  // The settings shell's PROJECT/ENVIRONMENT groups need a scope even on its
  // unscoped pages (keys, connection); this is where one is known for certain.
  useEffect(() => {
    if ('project' in route) {
      ScopeMemory.set(serverId, { project: route.project, env: route.env })
    }
  }, [serverId, 'project' in route ? route.project : null, 'env' in route ? route.env : null])

  const session = useWorkspaceSession(serverId, url, apiKey, scope, onDisconnect)
  const { ready, sessionInfo, claims, version, collections } = session

  const lastCollectionsMutationRef = useRef({ scopeKey, version: mutationVersion })
  useEffect(() => {
    if (lastCollectionsMutationRef.current.scopeKey !== scopeKey) {
      lastCollectionsMutationRef.current = { scopeKey, version: mutationVersion }
      return
    }
    if (lastCollectionsMutationRef.current.version === mutationVersion) return
    lastCollectionsMutationRef.current.version = mutationVersion
    void store.dispatch(StoreKeys.collections(serverId, scope), () =>
      api.collections.list(url, apiKey, scope),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey, mutationVersion, url, apiKey])

  useRouteGuard(ready, route, claims, collections, serverId, scope, activePendingSchemaRedirect)

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

  /** A write invalidates every page and entry the store holds for that
   *  collection and broadcasts to mounted views in the same credential
   *  session (surviving Settings visits that unmount and remount Workspace). */
  const afterEntriesChange = (name: string) => {
    if (store.sessionEpoch() !== epochAtSessionStart) return
    store.invalidatePrefix(StoreKeys.collection(serverId, scope, name))
    store.invalidate(StoreKeys.collections(serverId, scope))
    store.recordMutation(scopeKey, epochAtSessionStart)
  }

  return (
    <div className={styles.shell}>
      <Sidebar
        serverId={serverId}
        collections={collections.map((c) => ({ name: c.name, count: c.entries }))}
        activeCollection={route.view === 'entries' || route.view === 'entry' ? activeName : null}
        activePanel={route.view === 'media' ? 'media' : route.view === 'trash' ? 'trash' : null}
        claims={claims}
        version={version}
        instanceLabel={server.name}
        session={sessionBadge}
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
            claims={claims}
            session={sessionInfo}
            initialQuery={route.q}
            initialFolder={route.folder}
            onFolderChange={(folder) => {
              router.navigate(Routes.media(serverId, undefined, folder))
            }}
          />
        )}

        {route.view === 'trash' && (
          <Trash
            api={api}
            serverId={serverId}
            scope={scope}
            collections={smartCollections}
            url={url}
            apiKey={apiKey}
            claims={claims}
          />
        )}

        {route.view === 'schema' && route.collection !== null && !activeCollection && (
          <LoadingState message={`Loading ${route.collection}…`} />
        )}

        {route.view === 'schema' && (route.collection === null || activeCollection) && (() => {
          const backTo = activeCollection
            ? Routes.entries(serverId, scope.project, scope.env, activeCollection.name)
            : Routes.collections(serverId, scope.project, scope.env)
          const originatingCollection = route.collection
          const stillOnThisSchema = () => {
            const current = Routes.parse(router.getSnapshot())
            return (
              current !== null &&
              current.view === 'schema' &&
              current.serverId === serverId &&
              current.project === scope.project &&
              current.env === scope.env &&
              current.collection === originatingCollection
            )
          }
          const refreshAfterSchemaSave = (name: string) => {
            if (store.sessionEpoch() !== epochAtSessionStart) return Promise.resolve([])
            // `refresh`, not `invalidate`: the schema is read above, by a
            // hook whose key a save does not change, so a value only marked
            // stale is never asked for again until a reload.
            const schema = store.refresh(StoreKeys.schema(serverId, scope, name), () =>
              api.collections.get(url, apiKey, scope, name),
            )
            // Search reads this when it next switches on, and asks again then.
            store.invalidate(StoreKeys.schemas(serverId, scope))
            store.invalidate(StoreKeys.collections(serverId, scope))
            store.recordMutation(scopeKey, epochAtSessionStart)
            return Promise.all([schema, session.refreshCollections()])
          }
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
              onMutationStart={() => {
                if (
                  originatingCollection === null ||
                  store.sessionEpoch() !== epochAtSessionStart ||
                  !mountedRef.current
                ) {
                  return null
                }
                const mutationId = ++nextSchemaMutationIdRef.current
                setPendingSchemaRedirect({
                  serverId,
                  project: scope.project,
                  env: scope.env,
                  collection: originatingCollection,
                  mutationId,
                  navId: router.getNavId(),
                })
                return mutationId
              }}
              onMutationEnd={(mutationIdAtStart) => {
                if (mutationIdAtStart == null || !mountedRef.current) return
                setPendingSchemaRedirect((current) =>
                  SchemaRedirectGuard.release(current, mutationIdAtStart),
                )
              }}
              onMutated={(name) => {
                if (store.sessionEpoch() !== epochAtSessionStart) return
                pendingSchemaRefreshRef.current = refreshAfterSchemaSave(name)
              }}
              onSaved={(name, isCurrent, mutationIdAtStart) => {
                if (store.sessionEpoch() !== epochAtSessionStart || !isCurrent()) return
                const pending = pendingSchemaRefreshRef.current ?? refreshAfterSchemaSave(name)
                if (activeCollection && name === activeCollection.name) {
                  if (isCurrent() && stillOnThisSchema()) {
                    router.navigate(Routes.entries(serverId, scope.project, scope.env, name), {
                      force: true,
                    })
                  }
                  pendingSchemaRefreshRef.current = null
                  if (mountedRef.current) {
                    setPendingSchemaRedirect((current) =>
                      SchemaRedirectGuard.release(current, mutationIdAtStart, isCurrent()),
                    )
                  }
                  return
                }
                return pending
                  .then(() => {
                    if (
                      store.sessionEpoch() === epochAtSessionStart &&
                      isCurrent() &&
                      stillOnThisSchema()
                    ) {
                      router.navigate(Routes.entries(serverId, scope.project, scope.env, name), {
                        force: true,
                      })
                    }
                  })
                  .finally(() => {
                    pendingSchemaRefreshRef.current = null
                    if (mountedRef.current) {
                      setPendingSchemaRedirect((current) =>
                        SchemaRedirectGuard.release(current, mutationIdAtStart, isCurrent()),
                      )
                    }
                  })
              }}
              onCancel={() => router.navigate(backTo)}
              onDeletedMutated={() => {
                if (store.sessionEpoch() !== epochAtSessionStart) return
                if (activeCollection) {
                  store.invalidatePrefix(StoreKeys.collection(serverId, scope, activeCollection.name))
                }
                store.invalidate(StoreKeys.schemas(serverId, scope))
                store.invalidate(StoreKeys.collections(serverId, scope))
                store.recordMutation(scopeKey, epochAtSessionStart)
                pendingDeleteRefreshRef.current = session.refreshCollections()
              }}
              onDeleted={(isCurrent, mutationIdAtStart) => {
                if (store.sessionEpoch() !== epochAtSessionStart || !isCurrent()) return
                const pending = pendingDeleteRefreshRef.current ?? session.refreshCollections()
                return pending
                  .then((remaining) => {
                    if (
                      store.sessionEpoch() !== epochAtSessionStart ||
                      !isCurrent() ||
                      !stillOnThisSchema()
                    ) {
                      return
                    }
                    const next = remaining[0]
                    router.navigate(
                      next
                        ? Routes.entries(serverId, scope.project, scope.env, next.name)
                        : Routes.collections(serverId, scope.project, scope.env),
                      { force: true },
                    )
                  })
                  .finally(() => {
                    pendingDeleteRefreshRef.current = null
                    if (mountedRef.current) {
                      setPendingSchemaRedirect((current) =>
                        SchemaRedirectGuard.release(current, mutationIdAtStart, isCurrent()),
                      )
                    }
                  })
              }}
            />
          )
        })()}

        {route.view === 'entry' && activeCollection && (entryId === null || entry) && (() => {
          const historyState = router.getState<{ returnToken?: string }>()
          const returnRecord = ListReturnMemory.get(
            historyState?.returnToken,
            serverId,
            scope,
            activeCollection.name,
          )
          const returnTo =
            returnRecord?.returnTo ??
            Routes.entries(serverId, scope.project, scope.env, activeCollection.name)
          const returnState = returnRecord?.focusEntryId
            ? { focusEntryId: returnRecord.focusEntryId }
            : undefined
          const originatingCollection = activeCollection.name
          const stillOnThisEntry = () => {
            const current = Routes.parse(router.getSnapshot())
            return (
              current !== null &&
              current.view === 'entry' &&
              current.serverId === serverId &&
              current.project === scope.project &&
              current.env === scope.env &&
              current.collection === originatingCollection &&
              current.entryId === entryId
            )
          }
          return (
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
              session={sessionInfo}
              onRestored={() => afterEntriesChange(originatingCollection)}
              backTo={returnTo}
              backState={returnState}
              onMutated={() => afterEntriesChange(originatingCollection)}
              onSaved={(isCurrent) => {
                if (
                  store.sessionEpoch() === epochAtSessionStart &&
                  isCurrent() &&
                  stillOnThisEntry()
                ) {
                  router.navigate(returnTo, { force: true, state: returnState })
                }
              }}
              onCancel={() => router.navigate(returnTo, { state: returnState })}
              onDeleted={(isCurrent) => {
                if (
                  store.sessionEpoch() === epochAtSessionStart &&
                  isCurrent() &&
                  stillOnThisEntry()
                ) {
                  router.navigate(returnTo, { force: true })
                }
              }}
            />
          )
        })()}

        {route.view === 'entry' && (!activeCollection || (entryId !== null && !entry)) && (
          <LoadingState message="Loading entry…" />
        )}

        {route.view === 'entries' && !activeCollection && (
          <LoadingState message={`Loading ${activeName}…`} />
        )}

        {route.view === 'entries' && activeCollection && (() => {
          const historyState = router.getState<{ focusEntryId?: string }>()
          return (
            <EntriesView
              key={activeCollection.name}
              serverId={serverId}
              collection={activeCollection}
              collections={smartCollections}
              url={url}
              apiKey={apiKey}
              scope={scope}
              claims={claims}
              session={sessionInfo}
              refreshToken={entriesRefresh}
              focusEntryId={typeof historyState?.focusEntryId === 'string' ? historyState.focusEntryId : null}
              navigationKey={router.getNavId()}
              query={route.query}
              onQueryChange={(next: ListQuery, replace?: boolean) =>
                router.navigate(Routes.entries(serverId, scope.project, scope.env, activeCollection.name, next), { replace })
              }
              onEditSchema={() => router.navigate(Routes.schema(serverId, scope.project, scope.env, activeCollection.name))}
              onNewEntry={() => {
                const returnToken = ListReturnMemory.save(serverId, scope, activeCollection.name, {
                  returnTo: Routes.entries(serverId, scope.project, scope.env, activeCollection.name, route.query),
                  focusEntryId: null,
                })
                router.navigate(Routes.newEntry(serverId, scope.project, scope.env, activeCollection.name), {
                  state: returnToken ? { returnToken } : undefined,
                })
              }}
              onEditEntry={(entryItem) => {
                const returnToken = ListReturnMemory.save(serverId, scope, activeCollection.name, {
                  returnTo: Routes.entries(serverId, scope.project, scope.env, activeCollection.name, route.query),
                  focusEntryId: entryItem.id,
                })
                router.patchState({ focusEntryId: entryItem.id })
                router.navigate(Routes.entry(serverId, scope.project, scope.env, activeCollection.name, entryItem.id), {
                  state: returnToken ? { returnToken } : undefined,
                })
              }}
              onChanged={() => afterEntriesChange(activeCollection.name)}
            />
          )
        })()}

        {route.view === 'collections' && collections.length === 0 && (
          <>
            <TopBar
              search={
                <SmartSearch
                  serverId={serverId}
                  url={url}
                  apiKey={apiKey}
                  scope={scope}
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
          onUpdateServer={onUpdateServer}
          onForgetServer={onForgetServer}
          onOpenStatus={(id) => {
            setShowServerBrowser(false)
            router.navigate(Routes.serverSettings(id, 'connection'))
          }}
          onOpenProjectSettings={(id, project) => {
            setShowServerBrowser(false)
            router.navigate(Routes.projectSettings(id, project, 'general'))
          }}
          onOpenEnvSettings={(id, project, env) => {
            setShowServerBrowser(false)
            router.navigate(Routes.envSettings(id, project, env, 'general'))
          }}
          onClose={() => setShowServerBrowser(false)}
        />
      )}
    </div>
  )
}
