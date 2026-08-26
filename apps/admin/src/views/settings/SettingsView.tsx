import { Claims } from '@silo/shared/claims'
import { api } from '../../api/silo-api'
import { router } from '../../router/router'
import { Routes } from '../../router/routes'
import type { SettingsRoute } from '../../router/route'
import type { Server } from '../servers/server'
import { KeysView } from '../keys/Keys'
import { PluginsView } from '../plugins/Plugins'
import { PluginDetailView } from '../plugins/PluginDetail'
import { NewKeyView } from '../keys/NewKey'
import { ExportImportView } from '../transfer/ExportImport'
import { SettingsNav } from './SettingsNav'
import { useSettingsScope } from './use-settings-scope'
import { useSettingsSession } from './use-settings-session'
import { AppearancePage } from './pages/AppearancePage'
import { ConnectionPage } from './pages/ConnectionPage'
import { EnvGeneralPage } from './pages/EnvGeneralPage'
import { EnvTransferPage } from './pages/EnvTransferPage'
import { ProjectEnvironmentsPage } from './pages/ProjectEnvironmentsPage'
import { ProjectGeneralPage } from './pages/ProjectGeneralPage'
import { ProjectsPage } from './pages/ProjectsPage'
import styles from './SettingsView.module.css'

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

  const {
    scope,
    projects,
    environments,
    loadingProjects,
    loadingEnvironments,
    reloadProjects,
    reloadEnvironments,
  } = useSettingsScope(url, apiKey, serverId, route)

  const { claims, label, keyPrefix, version, collections } = useSettingsSession(url, apiKey, scope)

  const projectSection = route.view === 'project-settings' ? route.section : null
  const envSection = route.view === 'env-settings' ? route.section : null

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
          await api.projects.create(url, apiKey, id)
          await reloadProjects()
          selectProject(id)
        }}
        onCreateEnvironment={async (id) => {
          if (!scope) return
          await api.projects.createEnvironment(url, apiKey, scope.project, id)
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
            onChanged={reloadEnvironments}
          />
        )}

        {route.view === 'env-settings' && route.section === 'general' && (
          <EnvGeneralPage
            key={`${route.project}/${route.env}`}
            server={server}
            scope={{ project: route.project, env: route.env }}
            collections={collections}
            claims={claims}
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
          />
        )}

        {route.view === 'server-settings' && route.section === 'projects' && (
          <ProjectsPage
            server={server}
            projects={projects}
            loading={loadingProjects}
            claims={claims}
            onChanged={reloadProjects}
          />
        )}

        {route.view === 'server-settings' && route.section === 'keys' && (
          <KeysView
            url={url}
            apiKey={apiKey}
            claims={claims}
            onCreate={() => router.navigate(Routes.serverSettings(serverId, 'key-new'))}
          />
        )}

        {route.view === 'server-settings' && route.section === 'key-new' && (
          <NewKeyView
            url={url}
            apiKey={apiKey}
            // The resolved scope is only the *default* reach now — the form
            // picks its own project and env, so there is nothing to invent
            // when none resolved.
            scope={scope}
            ownClaims={claims}
            projects={projects}
            keysUrl={Routes.serverSettings(serverId, 'keys')}
            onCancel={() => router.navigate(Routes.serverSettings(serverId, 'keys'))}
            onDone={() => router.navigate(Routes.serverSettings(serverId, 'keys'))}
          />
        )}

        {route.view === 'server-settings' && route.section === 'plugins' && (
          <PluginsView
            serverId={serverId}
            url={url}
            apiKey={apiKey}
            claims={claims}
          />
        )}

        {/*
          Keyed on the plugin, so navigating between two of them cannot carry a
          half-edited grant across — the same reason the scoped pages above are
          keyed on their scope.
        */}
        {route.view === 'server-settings' && route.section === 'plugin' && route.plugin && (
          <PluginDetailView
            key={route.plugin}
            serverId={serverId}
            name={route.plugin}
            projects={projects}
            url={url}
            apiKey={apiKey}
            claims={claims}
          />
        )}

        {route.view === 'server-settings' && route.section === 'transfer' && (
          <ExportImportView
            url={url}
            apiKey={apiKey}
            claims={claims}
            collectionCount={collections.length}
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
            claims={claims}
            sessionLabel={label}
            keyPrefix={keyPrefix}
            version={version}
            onUpdateServer={onUpdateServer}
            onDeleteServer={onDeleteServer}
          />
        )}

        {route.view === 'server-settings' && route.section === 'appearance' && (
          <AppearancePage />
        )}
      </div>
    </div>
  )
}
