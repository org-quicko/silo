import {
  ArrowLeft,
  ArrowUpDown,
  FileCog,
  Folder,
  Image,
  KeyRound,
  Layers,
  Plug,
  Palette,
  Server as ServerIcon,
  SlidersHorizontal,
} from 'lucide-react'
import { useState } from 'react'
import type { ScopeRef } from '../../api/types/scope-ref'
import type { SettingsRoute } from '../../router/route'
import { Routes } from '../../router/routes'
import { ScopeSwitcher } from './ScopeSwitcher'
import styles from './SettingsNav.module.css'
import { SettingsNavItem } from './SettingsNavItem'

/**
 * Three groups, ordered outside-in: the server that hosts everything, the
 * projects it holds, and this browser.
 *
 * Scope nests the way the data does. One project's pages hang off the project
 * index, and one environment's hang off that project's environment list —
 * neither is a peer of the list it belongs to. Both nested blocks start
 * collapsed and open when the route enters them, so the nav reads as a short
 * list until you are actually working inside a scope.
 */
export function SettingsNav({
  serverId,
  serverName,
  route,
  scope,
  projects,
  environments,
  loadingProjects,
  loadingEnvironments,
  canCreateProject,
  canCreateEnvironment,
  onCreateProject,
  onCreateEnvironment,
  onSelectProject,
  onSelectEnvironment,
  onBackToWorkspace,
  onBack,
}: {
  serverId: string
  serverName: string
  route: SettingsRoute
  scope: ScopeRef | null
  projects: string[]
  environments: string[]
  loadingProjects: boolean
  loadingEnvironments: boolean
  canCreateProject: boolean
  canCreateEnvironment: boolean
  onCreateProject: (id: string) => Promise<void>
  onCreateEnvironment: (id: string) => Promise<void>
  onSelectProject: (project: string) => void
  onSelectEnvironment: (env: string) => void
  /** Omitted when no scope resolves, so there is no workspace to return to. */
  onBackToWorkspace?: () => void
  onBack: () => void
}) {
  const serverSection = route.view === 'server-settings' ? route.section : null
  const projectSection = route.view === 'project-settings' ? route.section : null
  const envSection = route.view === 'env-settings' ? route.section : null

  // Opened by acting on the row — its chevron, or following the row itself,
  // which is the one navigation that is *about* the environments. Still no
  // opening on route change alone: that used to fight a deliberate collapse
  // the moment the route re-entered the scope, and a page reached from a
  // breadcrumb or a link elsewhere is not a request to see this block.
  // Projects itself has no collapse of its own — it is the one group always
  // worth seeing into.
  const [environmentOpen, setEnvironmentOpen] = useState(false)

  return (
    <div className={styles.navColumn}>
      {/*
        Settings is a detour, so the way out is the first thing in it — and it
        returns to the scope you were working in, not to the server gate. Going
        out through the gate was the only exit before, which meant re-picking a
        project and environment to get back to where you already were.
      */}
      <div className={styles.navHeader}>
        {onBackToWorkspace && scope ? (
          <button
            type="button"
            className={styles.backBtn}
            onClick={onBackToWorkspace}
            title={`Back to the ${scope.project}/${scope.env} workspace on ${serverName}`}
          >
            <ArrowLeft size={14} className={styles.navHeaderIcon} />
            <span className={styles.navTitle}>Settings</span>
          </button>
        ) : (
          <button type="button" className={styles.backBtn} onClick={onBack} title="Back to servers">
            <ArrowLeft size={14} className={styles.navHeaderIcon} />
            <span className={styles.navTitle}>All servers</span>
          </button>
        )}
      </div>

      <nav className={styles.scroll}>
        <div className={styles.group}>
          <span className={styles.groupLabel}>Server</span>
          <SettingsNavItem
            to={Routes.serverSettings(serverId, 'keys')}
            icon={<KeyRound size={15} />}
            title="API Keys"
            active={serverSection === 'keys' || serverSection === 'key-new'}
          />
          <SettingsNavItem
            to={Routes.serverSettings(serverId, 'transfer')}
            icon={<ArrowUpDown size={15} />}
            title="Data Transfer"
            active={serverSection === 'transfer'}
          />
          <SettingsNavItem
            to={Routes.serverSettings(serverId, 'media-storage')}
            icon={<Image size={15} />}
            title="Media Library"
            active={serverSection === 'media-storage'}
          />
          <SettingsNavItem
            to={Routes.serverSettings(serverId, 'configuration')}
            icon={<FileCog size={15} />}
            title="Configuration"
            active={serverSection === 'configuration'}
          />
          <SettingsNavItem
            to={Routes.serverSettings(serverId, 'plugins')}
            icon={<Plug size={15} />}
            title="Plugins"
            active={serverSection === 'plugins' || serverSection === 'plugin'}
          />
          <SettingsNavItem
            to={Routes.serverSettings(serverId, 'connection')}
            icon={<ServerIcon size={15} />}
            title="Connection"
            active={serverSection === 'connection'}
          />
        </div>


        <div className={styles.group}>
          <span className={styles.groupLabel}>Projects</span>
          <SettingsNavItem
            to={Routes.serverSettings(serverId, 'projects')}
            icon={<Folder size={15} />}
            title="Projects"
            active={serverSection === 'projects'}
          />

          <div className={styles.subGroup}>
            <ScopeSwitcher
              icon={<Folder size={13} />}
              label="Project"
              options={projects}
              value={scope?.project ?? null}
              loading={loadingProjects}
              createLabel={canCreateProject ? 'New project' : undefined}
              onCreate={canCreateProject ? onCreateProject : undefined}
              onSelect={onSelectProject}
            />

            {scope ? (
              <>
                <SettingsNavItem
                  to={Routes.projectSettings(serverId, scope.project, 'general')}
                  icon={<SlidersHorizontal size={15} />}
                  title="General"
                  active={projectSection === 'general'}
                />
                <SettingsNavItem
                  to={Routes.projectSettings(serverId, scope.project, 'environments')}
                  icon={<Layers size={15} />}
                  title="Environments"
                  active={projectSection === 'environments'}
                  expanded={environmentOpen}
                  onToggleExpanded={() => setEnvironmentOpen((open) => !open)}
                  // Opens rather than toggles: clicking through to the
                  // environments list and having the block it belongs to shut
                  // underneath you is not what the click asked for.
                  onOpen={() => setEnvironmentOpen(true)}
                />

                {environmentOpen && (
                  <div className={styles.subGroup}>
                    <ScopeSwitcher
                      icon={<Layers size={13} />}
                      label="Environment"
                      options={environments}
                      value={scope.env}
                      loading={loadingEnvironments}
                      createLabel={canCreateEnvironment ? 'New environment' : undefined}
                      onCreate={canCreateEnvironment ? onCreateEnvironment : undefined}
                      onSelect={onSelectEnvironment}
                    />
                    <SettingsNavItem
                      to={Routes.envSettings(serverId, scope.project, scope.env, 'general')}
                      icon={<SlidersHorizontal size={15} />}
                      title="General"
                      active={envSection === 'general'}
                    />
                    <SettingsNavItem
                      to={Routes.envSettings(serverId, scope.project, scope.env, 'transfer')}
                      icon={<ArrowUpDown size={15} />}
                      title="Data Transfer"
                      active={envSection === 'transfer'}
                    />
                  </div>
                )}
              </>
            ) : (
              <span className={styles.groupPending}>Create a project to configure one.</span>
            )}
          </div>
        </div>


        <div className={styles.group}>
          <span className={styles.groupLabel}>Application</span>
          <SettingsNavItem
            to={Routes.serverSettings(serverId, 'appearance')}
            icon={<Palette size={15} />}
            title="Appearance"
            active={serverSection === 'appearance'}
          />
        </div>
      </nav>
    </div>
  )
}
