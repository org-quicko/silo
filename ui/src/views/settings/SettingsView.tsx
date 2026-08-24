import { useEffect, useState } from 'react'
import { Claims } from '@silo/shared/claims'
import { api } from '../../api/api-client'
import type { Collection } from '../../api/types/collection'
import { router } from '../../router/router'
import { Routes } from '../../router/routes'
import { DEFAULT_LIST_QUERY } from '../../router/list-query'
import type { SettingsRoute } from '../../router/route'
import type { Server } from '../servers/server'
import { CommandPalette } from '../search/CommandPalette'
import type { PaletteSeed } from '../search/palette-seed'
import { KeysView } from '../keys/Keys'
import { NewKeyView } from '../keys/NewKey'
import { ExportImportView } from '../transfer/ExportImport'
import { SettingsNav } from './SettingsNav'
import { useSettingsScope } from './use-settings-scope'
import { AppearancePage } from './pages/AppearancePage'
import { ConnectionPage } from './pages/ConnectionPage'
import { EnvGeneralPage } from './pages/EnvGeneralPage'
import { EnvTransferPage } from './pages/EnvTransferPage'
import { ProjectEnvironmentsPage } from './pages/ProjectEnvironmentsPage'
import { ProjectGeneralPage } from './pages/ProjectGeneralPage'
import { ProjectsPage } from './pages/ProjectsPage'
import styles from './SettingsView.module.css'
import { buildSessionBadge } from '../shell/build-session-badge'

interface SettingsViewProps {
  server: Server
  route: SettingsRoute
  onUpdateServer: (patch: Partial<Server>) => void
  onDeleteServer: () => void
  onBack: () => void
}

/**
 * The settings shell: a nav column scoped by group (project / environment /
 * server / application) and whichever page the URL names.
 */
export function SettingsView({ server, route, onUpdateServer, onDeleteServer, onBack }: SettingsViewProps) {
  const { id: serverId, url, apiKey } = server
  const [claims, setClaims] = useState<string[]>([])
  const [sessionLabel, setSessionLabel] = useState('')
  const [version, setVersion] = useState('')
  const [keyPrefix, setKeyPrefix] = useState('')
  const [collections, setCollections] = useState<Collection[]>([])
  // Seeds the instance overlay from whichever `SmartSearch` is mounted on the
  // current settings page — none of these pages have a table of their own to
  // show in-table results in, so every smart bar here hands off to it.
  const [palette, setPalette] = useState<PaletteSeed | null>(null)

  const {
    scope,
    projects,
    environments,
    loadingProjects,
    loadingEnvironments,
    reloadProjects,
    reloadEnvironments,
  } = useSettingsScope(url, apiKey, serverId, route)

  useEffect(() => {
    let alive = true
    Promise.all([api.health(url), api.getSession(url, apiKey)])
      .then(([health, session]) => {
        if (!alive) return
        setVersion(health.version || '')
        setClaims(session.claims || [])
        setSessionLabel(session.label || '')
        setKeyPrefix(session.prefix || '')
      })
      .catch(() => {
        /* surfaced by the Connection page's diagnostics */
      })
    return () => {
      alive = false
    }
  }, [url, apiKey])

  // The key form and the archive panels both need to know what the resolved
  // scope actually holds; without a scope in the URL they used to be handed
  // an empty list and a zero.
  useEffect(() => {
    let alive = true
    if (!scope) {
      setCollections([])
      return
    }
    api
      .listCollections(url, apiKey, scope)
      .then((items) => {
        if (alive) setCollections(items)
      })
      .catch(() => {
        if (alive) setCollections([])
      })
    return () => {
      alive = false
    }
  }, [url, apiKey, scope?.project, scope?.env])

  const session = buildSessionBadge({ label: sessionLabel, prefix: keyPrefix, claims }, scope)
  const projectSection = route.view === 'project-settings' ? route.section : null
  const envSection = route.view === 'env-settings' ? route.section : null

  const smartCollections = collections.map((c) => ({ name: c.name, count: null, schema: c.schema }))
  const goToCollectionSearch = (name: string, q: string) => {
    if (!scope) return
    router.navigate(Routes.entries(serverId, scope.project, scope.env, name, { ...DEFAULT_LIST_QUERY, q }))
  }

  // Picking a scope shows you that scope's settings, keeping the section you
  // were already on where it still exists at the new depth.
  const selectProject = (next: string) =>
    router.navigate(Routes.projectSettings(serverId, next, projectSection ?? 'general'))
  const selectEnvironment = (next: string) => {
    if (!scope) return
    router.navigate(Routes.envSettings(serverId, scope.project, next, envSection ?? 'general'))
  }

  return (
    <div className={styles.container}>
      <SettingsNav
        serverId={serverId}
        serverName={server.name}
        route={route}
        scope={scope}
        projects={projects}
        environments={environments}
        loadingProjects={loadingProjects}
        loadingEnvironments={loadingEnvironments}
        canCreateProject={Claims.hasAnyCollectionPermission(claims, Claims.CollectionCreate)}
        canCreateEnvironment={
          !!scope && Claims.hasAnyCollectionPermission(claims, Claims.CollectionCreate, scope.project, scope.env)
        }
        onCreateProject={async (id) => {
          await api.createProject(url, apiKey, id)
          await reloadProjects()
          selectProject(id)
        }}
        onCreateEnvironment={async (id) => {
          if (!scope) return
          await api.createEnvironment(url, apiKey, scope.project, id)
          await reloadEnvironments()
          selectEnvironment(id)
        }}
        onSelectProject={selectProject}
        onSelectEnvironment={selectEnvironment}
        onBackToWorkspace={
          scope
            ? () => router.navigate(Routes.collections(serverId, scope.project, scope.env))
            : undefined
        }
        onBack={onBack}
      />

      {/*
        Scope-bound pages are keyed on their scope: switching project or
        environment must not carry a previous scope's in-flight form or copy
        result across, which would report an action against the wrong target.
      */}
      <div className={styles.contentColumn}>
        {route.view === 'project-settings' && route.section === 'general' && (
          <ProjectGeneralPage
            key={route.project}
            server={server}
            project={route.project}
            environments={environments}
            claims={claims}
            session={session}
            smartCollections={smartCollections}
            onOpenPalette={setPalette}
            onNavigateToCollection={goToCollectionSearch}
            onDeleted={() => {
              reloadProjects()
              router.navigate(Routes.servers())
            }}
          />
        )}

        {route.view === 'project-settings' && route.section === 'environments' && (
          <ProjectEnvironmentsPage
            key={route.project}
            server={server}
            project={route.project}
            environments={environments}
            loading={loadingEnvironments}
            claims={claims}
            session={session}
            smartCollections={smartCollections}
            onOpenPalette={setPalette}
            onNavigateToCollection={goToCollectionSearch}
            onChanged={reloadEnvironments}
          />
        )}

        {route.view === 'env-settings' && route.section === 'general' && (
          <EnvGeneralPage
            key={`${route.project}/${route.env}`}
            server={server}
            scope={{ project: route.project, env: route.env }}
            collections={collections}
            session={session}
            claims={claims}
            smartCollections={smartCollections}
            onOpenPalette={setPalette}
            onNavigateToCollection={goToCollectionSearch}
            onDeleted={() => {
              reloadEnvironments()
              router.navigate(Routes.projectSettings(serverId, route.project, 'environments'))
            }}
          />
        )}

        {route.view === 'env-settings' && route.section === 'transfer' && (
          <EnvTransferPage
            key={`${route.project}/${route.env}`}
            server={server}
            scope={{ project: route.project, env: route.env }}
            projects={projects}
            claims={claims}
            session={session}
            smartCollections={smartCollections}
            onOpenPalette={setPalette}
            onNavigateToCollection={goToCollectionSearch}
          />
        )}

        {route.view === 'server-settings' && route.section === 'projects' && (
          <ProjectsPage
            server={server}
            projects={projects}
            loading={loadingProjects}
            claims={claims}
            session={session}
            smartCollections={smartCollections}
            scope={scope}
            onOpenPalette={setPalette}
            onNavigateToCollection={goToCollectionSearch}
            onChanged={reloadProjects}
          />
        )}

        {route.view === 'server-settings' && route.section === 'keys' && (
          <KeysView
            serverId={serverId}
            scope={scope}
            smartCollections={smartCollections}
            url={url}
            apiKey={apiKey}
            claims={claims}
            session={session}
            onOpenPalette={setPalette}
            onNavigateToCollection={goToCollectionSearch}
            onCreate={() => router.navigate(Routes.serverSettings(serverId, 'key-new'))}
          />
        )}

        {route.view === 'server-settings' && route.section === 'key-new' && (
          <NewKeyView
            serverId={serverId}
            smartCollections={smartCollections}
            url={url}
            apiKey={apiKey}
            // The resolved scope is only the *default* reach now — the form
            // picks its own project and env, so there is nothing to invent
            // when none resolved.
            scope={scope}
            ownClaims={claims}
            projects={projects}
            session={session}
            keysUrl={Routes.serverSettings(serverId, 'keys')}
            onOpenPalette={setPalette}
            onNavigateToCollection={goToCollectionSearch}
            onCancel={() => router.navigate(Routes.serverSettings(serverId, 'keys'))}
            onDone={() => router.navigate(Routes.serverSettings(serverId, 'keys'))}
          />
        )}

        {route.view === 'server-settings' && route.section === 'transfer' && (
          <ExportImportView
            serverId={serverId}
            scope={scope}
            smartCollections={smartCollections}
            url={url}
            apiKey={apiKey}
            claims={claims}
            session={session}
            collectionCount={collections.length}
            onOpenPalette={setPalette}
            onNavigateToCollection={goToCollectionSearch}
            onImported={() => {
              reloadProjects()
              reloadEnvironments()
            }}
            onDestinationKeyChanged={(key) => onUpdateServer({ apiKey: key })}
          />
        )}

        {route.view === 'server-settings' && route.section === 'connection' && (
          <ConnectionPage
            server={server}
            session={session}
            claims={claims}
            sessionLabel={sessionLabel}
            keyPrefix={keyPrefix}
            version={version}
            scope={scope}
            smartCollections={smartCollections}
            onOpenPalette={setPalette}
            onNavigateToCollection={goToCollectionSearch}
            onUpdateServer={onUpdateServer}
            onDeleteServer={onDeleteServer}
          />
        )}

        {route.view === 'server-settings' && route.section === 'appearance' && (
          <AppearancePage
            serverId={serverId}
            scope={scope}
            smartCollections={smartCollections}
            session={session}
            onOpenPalette={setPalette}
            onNavigateToCollection={goToCollectionSearch}
          />
        )}
      </div>

      {palette && (
        <CommandPalette
          serverId={serverId}
          url={url}
          apiKey={apiKey}
          // No settings page has a scope of its own to fall back on when none
          // is resolved yet; an empty one never matches a real hit, so every
          // result still carries its own project/env tag rather than one of
          // them going unexplained.
          scope={scope ?? { project: '', env: '' }}
          claims={claims}
          initialQuery={palette.q}
          reach={palette.collection ? { collection: palette.collection } : undefined}
          onNavigate={(href) => router.navigate(href)}
          onClose={() => setPalette(null)}
        />
      )}
    </div>
  )
}
