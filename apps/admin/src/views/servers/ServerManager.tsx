import { useEffect, useState } from 'react'
import { ArrowRight, Plus } from 'lucide-react'
import { SiloMark } from '../../components/brand/SiloMark'
import { Button } from '../../components/buttons/Button'
import { AddServerDialog } from './AddServerDialog'
import { EnvironmentColumn } from './EnvironmentColumn'
import { ProjectColumn } from './ProjectColumn'
import { ScopeBreadcrumb } from './ScopeBreadcrumb'
import { ServerColumn } from './ServerColumn'
import type { Server } from './server'
import { useScopeBrowser } from './use-scope-browser'
import styles from './ServerManager.module.css'

interface Props {
  servers: Server[]
  onConnect: (serverId: string, project: string, env: string) => void
  onAddServer: (server: Server) => void
  onOpenStatus: (serverId: string) => void
  initialServerId?: string | null
  initialProject?: string | null
  initialEnv?: string | null
  /** Present when the browser is a modal over a workspace rather than the
   *  welcome gate; it is what makes Esc and the backdrop dismiss it. */
  onClose?: () => void
}

/**
 * Picking where to work: a server, one of its projects, one of that project's
 * environments.
 *
 * Three columns walked left to right, with the loading and creation of each
 * held by `useScopeBrowser` so this file stays layout.
 */
export function ServerManager({
  servers,
  onConnect,
  onAddServer,
  onOpenStatus,
  initialServerId,
  initialProject,
  initialEnv,
  onClose,
}: Props) {
  const browser = useScopeBrowser(servers, {
    serverId: initialServerId ?? null,
    project: initialProject ?? null,
    env: initialEnv ?? null,
  })
  const [addingServer, setAddingServer] = useState(false)

  useEffect(() => {
    if (!onClose) return
    const onKeyDown = (event: KeyboardEvent) => {
      // The dialog owns Esc while it is open, so the browser does not close
      // underneath it.
      if (event.key === 'Escape' && !addingServer) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, addingServer])

  const connect = () => {
    if (browser.server && browser.project && browser.env) {
      onConnect(browser.server.id, browser.project, browser.env)
    }
  }

  const content = (
    <div className={styles.window} onMouseDown={(event) => event.stopPropagation()}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <div className={styles.logo}>
            <SiloMark size={28} stroke="var(--accent)" />
          </div>
          <div className={styles.brandText}>
            <h1>Silo CMS</h1>
            <span className={styles.badge}>Server Browser</span>
          </div>
        </div>
        <div className={styles.headerActions}>
          <Button type="button" variant="primary" onClick={() => setAddingServer(true)}>
            <Plus size={15} /> Add Server
          </Button>
          {onClose && (
            <button
              type="button"
              className={styles.closeBtn}
              onClick={onClose}
              title="Close (Esc)"
              aria-label="Close"
            >
              ×
            </button>
          )}
        </div>
      </header>

      {browser.error && (
        <div className={styles.bannerError}>
          <span>{browser.error}</span>
          <button type="button" onClick={() => browser.setError('')}>
            ×
          </button>
        </div>
      )}

      <div className={styles.columnsContainer}>
        <ServerColumn
          servers={servers}
          selectedId={browser.serverId}
          onSelect={browser.selectServer}
          onOpenStatus={onOpenStatus}
        />
        <ProjectColumn
          serverId={browser.serverId}
          projects={browser.projects}
          selected={browser.project}
          loading={browser.loadingProjects}
          onSelect={browser.selectProject}
          onCreate={browser.createProject}
        />
        <EnvironmentColumn
          serverId={browser.serverId}
          project={browser.project}
          environments={browser.environments}
          selected={browser.env}
          loading={browser.loadingEnvironments}
          onSelect={browser.selectEnv}
          onCreate={browser.createEnvironment}
          onActivate={connect}
        />
      </div>

      <footer className={styles.footer}>
        <ScopeBreadcrumb
          server={browser.server?.name ?? null}
          project={browser.project}
          env={browser.env}
        />
        <Button
          type="button"
          variant="primary"
          disabled={!browser.complete}
          onClick={connect}
          className={styles.connectBtn}
        >
          <span>Open Workspace</span>
          <ArrowRight size={15} />
        </Button>
      </footer>
    </div>
  )

  return (
    <>
      {onClose ? (
        <div className={styles.modalBackdrop} onMouseDown={onClose}>
          {content}
        </div>
      ) : (
        <div className={styles.gate}>
          <div className={styles.glow} />
          {content}
        </div>
      )}

      {addingServer && (
        <AddServerDialog
          onAdd={(server) => {
            onAddServer(server)
            browser.setServerId(server.id)
            setAddingServer(false)
          }}
          onClose={() => setAddingServer(false)}
        />
      )}
    </>
  )
}
