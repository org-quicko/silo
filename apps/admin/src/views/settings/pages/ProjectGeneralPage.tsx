import { useState } from 'react'
import { AlertTriangle, FolderGit2, Layers, Trash2 } from 'lucide-react'
import { Claims } from '@silo/shared/claims'
import { Button } from '../../../components/buttons/Button'
import { Breadcrumb } from '../../../components/navigation/Breadcrumb'
import { DangerConfirm } from '../../../components/modal/DangerConfirm'
import { api } from '../../../api/silo-api'
import { Routes } from '../../../router/routes'
import { RenameForm } from '../rename/RenameForm'
import { TopBar } from '../../shell/TopBar'
import type { Server } from '../../servers/server'
import styles from '../SettingsView.module.css'

/**
 * What a project *is* on this instance, what it is called, and the one
 * irreversible thing you can do to it.
 *
 * Since D51 a project is a record with a stable ULID and a mutable name, so the
 * Identity card carries a rename. The delete stays in its own card, away from
 * every other control.
 */
export function ProjectGeneralPage({
  server,
  project,
  projectId,
  environments,
  claims,
  onRenamed,
  onDeleted,
}: {
  server: Server
  project: string
  projectId: string
  environments: string[]
  claims: string[]
  onRenamed: (name: string) => void | Promise<void>
  onDeleted: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Every environment of the project, and both halves of what `force` costs
  // (D37) — see `EnvGeneralPage` for why "any collection" was the wrong question.
  const canDelete = Claims.hasScopeWide(claims, Claims.ForcedDeletePermissions, project, '*')
  // A rename is a create at the new name and a delete at the old, project-wide
  // (D51). The server also checks the *new* name, which it cannot know here, so
  // a refusal can still arrive — the control reports it rather than hiding it.
  const canRename =
    projectId.length > 0 &&
    Claims.hasScopeWide(claims, Claims.RenamePermissions, project, '*')

  const remove = async () => {
    setBusy(true)
    setError('')
    try {
      await api.projects.delete(server.url, server.apiKey, project, true)
      setConfirming(false)
      onDeleted()
    } catch (caught: any) {
      setError(caught.message || 'Failed to delete project')
      setBusy(false)
    }
  }

  return (
    <>
      <TopBar />

      <div className="content">
        <Breadcrumb
          crumbs={[
            { label: 'Projects', to: Routes.serverSettings(server.id, 'projects') },
            { label: project },
            { label: 'General' },
          ]}
        />
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
                The name appears in every API path and in every claim naming this project.
                Renaming rewrites those claims. The id never changes.
              </p>
            </div>

            <div className={styles.diagnosticsGrid}>
              <div className={styles.diagCard}>
                <span className={styles.diagLabel}>Project id</span>
                <span className={styles.diagMono}>{projectId || '—'}</span>
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

            <RenameForm
              subject={{ noun: 'project', currentName: project, id: projectId }}
              allowed={canRename}
              unavailableReason={`This key cannot rename ${project}. A rename retires the old name and introduces a new one, so it needs collections:create and collections:delete across the project.`}
              rename={(name, dryRun) =>
                api.projects.rename(server.url, server.apiKey, project, name, projectId, dryRun)
              }
              onRenamed={onRenamed}
            />
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
                  This key cannot delete {project} — deleting a project erases
                  every collection in every one of its environments, so it needs{' '}
                  {Claims.ForcedDeletePermissions.map((permission, index) => (
                    <span key={permission}>
                      {index > 0 && ' and '}
                      <code>{Claims.collection(project, '*', '*', permission)}</code>
                    </span>
                  ))}.
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
