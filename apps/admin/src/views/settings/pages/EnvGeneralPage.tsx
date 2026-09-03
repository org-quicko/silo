import { useState } from 'react'
import { AlertTriangle, ExternalLink, Layers, Trash2 } from 'lucide-react'
import { Claims } from '@silo/shared/claims'
import { Button } from '../../../components/buttons/Button'
import { Breadcrumb } from '../../../components/navigation/Breadcrumb'
import { DangerConfirm } from '../../../components/modal/DangerConfirm'
import { Pill } from '../../../components/feedback/Pill'
import { api } from '../../../api/silo-api'
import type { CollectionSummary } from '../../../api/types/collection-summary'
import type { ScopeRef } from '../../../api/types/scope-ref'
import { router } from '../../../router/router'
import { Routes } from '../../../router/routes'
import { RenameForm } from '../rename/RenameForm'
import { TopBar } from '../../shell/TopBar'
import type { Server } from '../../servers/server'
import styles from '../SettingsView.module.css'

/**
 * One environment: what it holds, what it is called, how to address it, and how
 * to delete it.
 *
 * Like a project it is a record with a stable ULID and a mutable name since
 * D51, so the Contents card carries a rename.
 */
export function EnvGeneralPage({
  server,
  scope,
  envId,
  collections,
  claims,
  onRenamed,
  onDeleted,
}: {
  server: Server
  scope: ScopeRef
  envId: string
  collections: CollectionSummary[]
  claims: string[]
  onRenamed: (name: string) => void | Promise<void>
  onDeleted: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Scope-wide and both halves (D37). The delete always passes `force`, which
  // erases every entry in the environment — and even unforced it reaches every
  // collection, so `hasAnyCollectionPermission` was asking about one collection
  // to authorize all of them.
  const canDelete = Claims.hasScopeWide(
    claims,
    Claims.ForcedDeletePermissions,
    scope.project,
    scope.env,
  )
  // A create at the new name and a delete at the old, across the environment
  // (D51).
  const canRename =
    envId.length > 0 &&
    Claims.hasScopeWide(claims, Claims.RenamePermissions, scope.project, scope.env)

  const remove = async () => {
    setBusy(true)
    setError('')
    try {
      await api.projects.deleteEnvironment(server.url, server.apiKey, scope.project, scope.env, true)
      setConfirming(false)
      onDeleted()
    } catch (caught: any) {
      setError(caught.message || 'Failed to delete environment')
      setBusy(false)
    }
  }

  return (
    <>
      <TopBar />

      <div className="content">
        <Breadcrumb
          crumbs={[
            { label: scope.project, to: Routes.projectSettings(server.id, scope.project, 'general') },
            { label: scope.env, to: Routes.projectSettings(server.id, scope.project, 'environments') },
            { label: 'General' },
          ]}
        />
        <div className="page-head">
          <div className="page-title-group">
            <h2 className="page-title">{scope.env}</h2>
            <span className="page-sub">
              An environment of <b>{scope.project}</b>. Its collections and entries are entirely its own —
              nothing is shared with the project's other environments.
            </span>
          </div>
          <div className="head-actions">
            <Button
              variant="secondary"
              onClick={() => router.navigate(Routes.collections(server.id, scope.project, scope.env))}
            >
              <ExternalLink size={14} />
              <span>Open workspace</span>
            </Button>
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
                <Layers size={16} />
                <h2>Contents</h2>
              </div>
              <p>What this environment holds right now, and the paths that address it.</p>
            </div>

            <div className={styles.diagnosticsGrid}>
              <div className={styles.diagCard}>
                <span className={styles.diagLabel}>Scope</span>
                <span className={styles.diagMono}>
                  {scope.project}/{scope.env}
                </span>
              </div>
              <div className={styles.diagCard}>
                <span className={styles.diagLabel}>Collections</span>
                <span className={styles.diagValue}>{collections.length}</span>
              </div>
              <div className={styles.diagCard}>
                <span className={styles.diagLabel}>API path</span>
                <span className={styles.diagMono}>
                  /api/projects/{scope.project}/environments/{scope.env}
                </span>
              </div>
              <div className={styles.diagCard}>
                <span className={styles.diagLabel}>Environment id</span>
                <span className={styles.diagMono}>{envId || '—'}</span>
              </div>
            </div>

            <RenameForm
              subject={{ noun: 'environment', currentName: scope.env, id: envId }}
              allowed={canRename}
              unavailableReason={`This key cannot rename ${scope.env}. A rename retires the old name and introduces a new one, so it needs collections:create and collections:delete across the environment.`}
              rename={(name, dryRun) =>
                api.projects.renameEnvironment(
                  server.url,
                  server.apiKey,
                  scope.project,
                  scope.env,
                  name,
                  envId,
                  dryRun,
                )
              }
              onRenamed={onRenamed}
            />

            {collections.length > 0 && (
              <div className={styles.claimsBlock}>
                <div className={styles.claimsTitle}>
                  <Layers size={14} />
                  <span>Collections here</span>
                </div>
                <div className={styles.claimsList}>
                  {collections.map((collection) => (
                    <Pill key={collection.name} tone="ok">
                      {collection.name}
                    </Pill>
                  ))}
                </div>
              </div>
            )}
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
                <span className={styles.dangerItemTitle}>Delete this environment</span>
                <p className={styles.dangerItemDesc}>
                  Deletes {scope.project}/{scope.env} and{' '}
                  {collections.length === 1
                    ? 'its 1 collection'
                    : `all ${collections.length} of its collections`}
                  , schemas and entries included. {scope.project} itself and its other environments stay.
                </p>
              </div>

              <Button type="button" variant="danger" disabled={!canDelete} onClick={() => setConfirming(true)}>
                <Trash2 size={14} />
                <span>Delete environment</span>
              </Button>
            </div>

            {!canDelete && (
              <div className={styles.dangerItem}>
                <p className={styles.dangerItemDesc}>
                  This key cannot delete {scope.env} — deleting an environment
                  erases every collection in it, so it needs{' '}
                  {Claims.ForcedDeletePermissions.map((permission, index) => (
                    <span key={permission}>
                      {index > 0 && ' and '}
                      <code>{Claims.collection(scope.project, scope.env, '*', permission)}</code>
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
          title="Delete this environment?"
          confirmWord={scope.env}
          confirmLabel="Delete environment"
          busy={busy}
          onConfirm={remove}
          onCancel={() => setConfirming(false)}
        >
          Every collection, schema and entry in <b>{scope.project}/{scope.env}</b> is deleted permanently.
          This cannot be undone.
        </DangerConfirm>
      )}
    </>
  )
}
