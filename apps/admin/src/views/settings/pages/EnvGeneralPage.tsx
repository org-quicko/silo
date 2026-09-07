import { useState } from 'react'
import { AlertTriangle, ExternalLink } from 'lucide-react'
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
import { TopBar } from '../../shell/TopBar'
import type { Server } from '../../servers/server'
import { DestructiveRow } from '../parts/DestructiveRow'
import { DestructiveSection } from '../parts/DestructiveSection'
import { FactList } from '../parts/FactList'
import { RenameableTitle } from '../parts/RenameableTitle'
import { SettingsPageHead } from '../parts/SettingsPageHead'
import { SettingsRow } from '../parts/SettingsRow'
import { SettingsSection } from '../parts/SettingsSection'
import ledger from '../parts/SettingsLedger.module.css'
import styles from '../SettingsView.module.css'

/**
 * One environment: what it holds, what it is called, how to address it, and how
 * to delete it.
 *
 * Like a project it is a record with a stable ULID and a mutable name since
 * D51, so the page title is the rename control.
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
            { label: server.name },
            { label: scope.project, to: Routes.projectSettings(server.id, scope.project, 'general') },
            {
              label: scope.env,
              to: Routes.projectSettings(server.id, scope.project, 'environments'),
            },
            { label: 'General' },
          ]}
        />

        <SettingsPageHead
          mono
          title={
            <RenameableTitle
              subject={{ noun: 'environment', currentName: scope.env, id: envId }}
              allowed={canRename}
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
          }
          sub="Renaming rewrites every claim naming this environment. The id never changes."
          actions={
            <Button
              variant="secondary"
              onClick={() =>
                router.navigate(Routes.collections(server.id, scope.project, scope.env))
              }
            >
              <ExternalLink size={14} />
              <span>Open workspace</span>
            </Button>
          }
        />

        {error && (
          <div className={styles.alertError}>
            <AlertTriangle size={15} />
            <span>{error}</span>
          </div>
        )}

        <SettingsSection title="Identity" hint="Read-only" divider={false}>
          <FactList
            facts={[
              { key: 'Environment ID', value: envId || '—' },
              {
                key: 'API path',
                value: `/api/projects/${scope.project}/environments/${scope.env}`,
              },
            ]}
          />
        </SettingsSection>

        <SettingsSection title="Contents">
          <SettingsRow
            label={collections.length === 1 ? '1 collection' : `${collections.length} collections`}
            stack={collections.length > 0}
          >
            {collections.length > 0 ? (
              <div className={ledger.chips}>
                {collections.map((collection) => (
                  <Pill key={collection.name} tone="ok">
                    {collection.name}
                  </Pill>
                ))}
              </div>
            ) : (
              <Button
                variant="secondary"
                onClick={() =>
                  router.navigate(Routes.collections(server.id, scope.project, scope.env))
                }
              >
                Create one
              </Button>
            )}
          </SettingsRow>
        </SettingsSection>

        <DestructiveSection>
          <DestructiveRow
            title="Delete this environment"
            blast={
              canDelete ? (
                <>
                  Deletes{' '}
                  <strong>
                    {scope.project}/{scope.env}
                  </strong>{' '}
                  and{' '}
                  {collections.length === 1
                    ? 'its 1 collection'
                    : `all ${collections.length} of its collections`}
                  , schemas and entries included. {scope.project} itself stays.
                </>
              ) : (
                <>
                  This key cannot delete {scope.env}. Deleting an environment erases every collection
                  in it, so it needs{' '}
                  {Claims.ForcedDeletePermissions.map((permission, index) => (
                    <span key={permission}>
                      {index > 0 && ' and '}
                      <code>{Claims.collection(scope.project, scope.env, '*', permission)}</code>
                    </span>
                  ))}
                  .
                </>
              )
            }
          >
            <Button
              type="button"
              variant="danger"
              disabled={!canDelete}
              onClick={() => setConfirming(true)}
            >
              Delete environment
            </Button>
          </DestructiveRow>
        </DestructiveSection>
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
          Every collection, schema and entry in{' '}
          <b>
            {scope.project}/{scope.env}
          </b>{' '}
          is deleted permanently. This cannot be undone.
        </DangerConfirm>
      )}
    </>
  )
}
