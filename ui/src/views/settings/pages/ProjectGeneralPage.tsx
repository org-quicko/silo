import { useState } from 'react'
import { AlertTriangle, FolderGit2, Layers, Trash2 } from 'lucide-react'
import { Claims } from '@silo/shared/claims'
import { Button } from '../../../components/Button'
import { DangerConfirm } from '../../../components/DangerConfirm'
import { api } from '../../../api/api-client'
import { Routes } from '../../../router/routes'
import { TopBar } from '../../shell/TopBar'
import type { Server } from '../../servers/server'
import styles from '../SettingsView.module.css'
import type { SessionBadge } from '../../shell/session-badge'

/**
 * What a project *is* on this instance, and the one irreversible thing you can
 * do to it. A project has no metadata beyond its id (D18/D20), so there is
 * nothing here to rename or edit — the page exists to state the identity and
 * to keep the delete away from every other control.
 */
export function ProjectGeneralPage({
  server,
  project,
  environments,
  claims,
  session,
  onDeleted,
}: {
  server: Server
  project: string
  environments: string[]
  claims: string[]
  session: SessionBadge
  onDeleted: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const canDelete = Claims.hasAnyCollectionPermission(claims, Claims.CollectionDelete, project, '*')

  const remove = async () => {
    setBusy(true)
    setError('')
    try {
      await api.deleteProject(server.url, server.apiKey, project, true)
      setConfirming(false)
      onDeleted()
    } catch (err: any) {
      setError(err.message || 'Failed to delete project')
      setBusy(false)
    }
  }

  return (
    <>
      <TopBar
        crumbs={[
          { label: 'Projects', to: Routes.serverSettings(server.id, 'projects') },
          { label: project },
          { label: 'General' },
        ]}
        session={session}
      />

      <div className="content">
        <div className="page-head">
          <div className="page-title-group">
            <h2 className="page-title">{project}</h2>
            <span className="page-sub">
              A project is a container for environments, which in turn hold the collections and entries.
            </span>
          </div>
        </div>

        {error && (
          <div className={styles.alertError}>
            <AlertTriangle size={15} />
            <span>{error}</span>
          </div>
        )}

        <div className={styles.generalContent}>
          <section className={styles.card}>
            <div className={styles.cardHeader}>
              <div className={styles.sectionTitle}>
                <FolderGit2 size={16} />
                <h2>Identity</h2>
              </div>
              <p>
                The id is fixed: it appears in every API path and in every claim naming this project, so
                renaming it would invalidate existing keys and integrations.
              </p>
            </div>

            <div className={styles.diagnosticsGrid}>
              <div className={styles.diagCard}>
                <span className={styles.diagLabel}>Project id</span>
                <span className={styles.diagMono}>{project}</span>
              </div>
              <div className={styles.diagCard}>
                <span className={styles.diagLabel}>Environments</span>
                <span className={styles.diagValue}>{environments.length}</span>
              </div>
              <div className={styles.diagCard}>
                <span className={styles.diagLabel}>API path</span>
                <span className={styles.diagMono}>/api/projects/{project}</span>
              </div>
            </div>
          </section>

          <section className={`${styles.card} ${styles.dangerCard}`}>
            <div className={styles.cardHeader}>
              <div className={styles.dangerTitle}>
                <Trash2 size={16} className={styles.dangerIcon} />
                <h2>Danger Zone</h2>
              </div>
              <p>Permanent actions on the server itself, not just on this browser.</p>
            </div>

            <div className={styles.dangerItem}>
              <div className={styles.dangerItemInfo}>
                <span className={styles.dangerItemTitle}>Delete this project</span>
                <p className={styles.dangerItemDesc}>
                  Deletes {project} and{' '}
                  {environments.length === 1
                    ? 'its 1 environment'
                    : `all ${environments.length} of its environments`}
                  , with every collection, schema and entry inside them. There is no undo and no backup
                  unless you have exported one.
                </p>
                {environments.length > 0 && (
                  <p className={styles.dangerItemDesc}>
                    <Layers size={12} /> {environments.join(', ')}
                  </p>
                )}
              </div>

              <Button type="button" variant="danger" disabled={!canDelete} onClick={() => setConfirming(true)}>
                <Trash2 size={14} />
                <span>Delete project</span>
              </Button>
            </div>

            {!canDelete && (
              <div className={styles.dangerItem}>
                <p className={styles.dangerItemDesc}>
                  This key cannot delete {project} — it is missing{' '}
                  <code>{Claims.collection(project, '*', '*', Claims.CollectionDelete)}</code>.
                </p>
              </div>
            )}
          </section>
        </div>
      </div>

      {confirming && (
        <DangerConfirm
          title="Delete this project?"
          confirmWord={project}
          confirmLabel="Delete project"
          busy={busy}
          onConfirm={remove}
          onCancel={() => setConfirming(false)}
        >
          Everything under <b>{project}</b> is deleted permanently, across all of its environments. Keys
          scoped to this project keep their claims but will have nothing left to address.
        </DangerConfirm>
      )}
    </>
  )
}
