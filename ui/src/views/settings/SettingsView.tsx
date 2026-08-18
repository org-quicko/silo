import { useEffect, useState } from 'react'
import {
  SlidersHorizontal,
  FolderGit2,
  Layers,
  KeyRound,
  ArrowUpDown,
  Server as ServerIcon,
} from 'lucide-react'
import { api } from '../../api/api-client'
import { router } from '../../router/router'
import { Routes } from '../../router/routes'
import { Claims } from '@silo/shared/claims'
import type { SettingsSection } from '../../router/route'
import type { Server } from '../servers/server'
import { GeneralTab } from './tabs/GeneralTab'
import { ProjectsTab } from './tabs/ProjectsTab'
import { EnvironmentsTab } from './tabs/EnvironmentsTab'
import { ConnectionTab } from './tabs/ConnectionTab'
import { KeysView } from '../keys/Keys'
import { NewKeyView } from '../keys/NewKey'
import { ExportImportView } from '../transfer/ExportImport'
import styles from './SettingsView.module.css'

interface SettingsViewProps {
  server: Server
  section: SettingsSection
  onUpdateServer: (patch: Partial<Server>) => void
  onDeleteServer: () => void
  onBack: () => void
}

export function SettingsView({
  server,
  section,
  onUpdateServer,
  onDeleteServer,
  onBack,
}: SettingsViewProps) {
  const [claims, setClaims] = useState<string[]>([])
  const [sessionLabel, setSessionLabel] = useState<string>('')
  const [version, setVersion] = useState<string>('')
  const [keyPrefix, setKeyPrefix] = useState<string>('')

  // Verify and fetch session on mount
  useEffect(() => {
    let alive = true
    Promise.all([
      api.health(server.url),
      api.getSession(server.url, server.apiKey),
    ])
      .then(([health, sess]) => {
        if (!alive) return
        setVersion(health.version || '')
        setClaims(sess.claims || [])
        setSessionLabel(sess.label || '')
        setKeyPrefix(sess.prefix || '')
      })
      .catch(() => {
        /* handled in subcomponents */
      })

    return () => {
      alive = false
    }
  }, [server.url, server.apiKey])

  const session = `${sessionLabel || Claims.label(claims)} · ${server.name}`
  const activeSection = section === 'key-new' ? 'keys' : section

  return (
    <div className={styles.container}>
      {/* Settings Navigation Column */}
      <div className={styles.navColumn}>
        <div className={styles.navHeader}>
          <button type="button" className={styles.backBtn} onClick={onBack} title="Back to servers">
            <ServerIcon size={14} className={styles.navHeaderIcon} />
            <span className={styles.navTitle}>{server.name}</span>
          </button>
          <span className={styles.navBadge}>Settings</span>
        </div>

        <nav className={styles.navList}>
          <button
            type="button"
            className={`${styles.navItem} ${activeSection === 'general' ? styles.active : ''}`}
            onClick={() => router.navigate(Routes.settingsGeneral(server.id))}
          >
            <SlidersHorizontal size={15} className={styles.navIcon} />
            <div className={styles.navItemText}>
              <span className={styles.navItemTitle}>General</span>
              <span className={styles.navItemSubtitle}>Fonts & accent color</span>
            </div>
          </button>

          <button
            type="button"
            className={`${styles.navItem} ${activeSection === 'projects' ? styles.active : ''}`}
            onClick={() => router.navigate(Routes.settingsProjects(server.id))}
          >
            <FolderGit2 size={15} className={styles.navIcon} />
            <div className={styles.navItemText}>
              <span className={styles.navItemTitle}>Projects</span>
              <span className={styles.navItemSubtitle}>Root project scopes</span>
            </div>
          </button>

          <button
            type="button"
            className={`${styles.navItem} ${activeSection === 'environments' ? styles.active : ''}`}
            onClick={() => router.navigate(Routes.settingsEnvironments(server.id))}
          >
            <Layers size={15} className={styles.navIcon} />
            <div className={styles.navItemText}>
              <span className={styles.navItemTitle}>Environments</span>
              <span className={styles.navItemSubtitle}>Project environments</span>
            </div>
          </button>

          <button
            type="button"
            className={`${styles.navItem} ${activeSection === 'keys' ? styles.active : ''}`}
            onClick={() => router.navigate(Routes.settingsKeys(server.id))}
          >
            <KeyRound size={15} className={styles.navIcon} />
            <div className={styles.navItemText}>
              <span className={styles.navItemTitle}>API Keys</span>
              <span className={styles.navItemSubtitle}>Server access tokens</span>
            </div>
          </button>

          <button
            type="button"
            className={`${styles.navItem} ${activeSection === 'transfer' ? styles.active : ''}`}
            onClick={() => router.navigate(Routes.settingsTransfer(server.id))}
          >
            <ArrowUpDown size={15} className={styles.navIcon} />
            <div className={styles.navItemText}>
              <span className={styles.navItemTitle}>Data Transfer</span>
              <span className={styles.navItemSubtitle}>Export, import & copy</span>
            </div>
          </button>

          <div className={styles.navDivider} />

          <button
            type="button"
            className={`${styles.navItem} ${activeSection === 'connection' ? styles.active : ''}`}
            onClick={() => router.navigate(Routes.settingsConnection(server.id))}
          >
            <ServerIcon size={15} className={styles.navIcon} />
            <div className={styles.navItemText}>
              <span className={styles.navItemTitle}>Connection & Status</span>
              <span className={styles.navItemSubtitle}>Health, diagnostics & danger</span>
            </div>
          </button>
        </nav>
      </div>

      {/* Main Settings Content Area */}
      <div className={styles.contentColumn}>
        {section === 'general' && (
          <GeneralTab session={session} onBack={onBack} />
        )}

        {section === 'projects' && (
          <ProjectsTab server={server} session={session} onBack={onBack} />
        )}

        {section === 'environments' && (
          <EnvironmentsTab server={server} session={session} onBack={onBack} />
        )}

        {section === 'keys' && (
          <KeysView
            url={server.url}
            apiKey={server.apiKey}
            claims={claims}
            session={session}
            onLock={onBack}
            onCreate={() => router.navigate(Routes.settingsNewKey(server.id))}
          />
        )}

        {section === 'key-new' && (
          <NewKeyView
            url={server.url}
            apiKey={server.apiKey}
            scope={{ project: 'default', env: 'prod' }}
            ownClaims={claims}
            collections={[]}
            session={session}
            keysUrl={Routes.settingsKeys(server.id)}
            onCancel={() => router.navigate(Routes.settingsKeys(server.id))}
            onDone={() => router.navigate(Routes.settingsKeys(server.id))}
            onLock={onBack}
          />
        )}

        {section === 'transfer' && (
          <ExportImportView
            url={server.url}
            apiKey={server.apiKey}
            claims={claims}
            session={session}
            onLock={onBack}
            collectionCount={0}
            onImported={() => {}}
            onDestinationKeyChanged={(k) => onUpdateServer({ apiKey: k })}
          />
        )}

        {section === 'connection' && (
          <ConnectionTab
            server={server}
            session={session}
            claims={claims}
            sessionLabel={sessionLabel}
            keyPrefix={keyPrefix}
            version={version}
            onUpdateServer={onUpdateServer}
            onDeleteServer={onDeleteServer}
            onBack={onBack}
          />
        )}
      </div>
    </div>
  )
}
