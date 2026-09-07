import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Claims } from '@silo/shared/claims'
import { Button } from '../../../components/buttons/Button'
import { Breadcrumb } from '../../../components/navigation/Breadcrumb'
import { DangerConfirm } from '../../../components/modal/DangerConfirm'
import { api } from '../../../api/silo-api'
import { Routes } from '../../../router/routes'
import { TopBar } from '../../shell/TopBar'
import type { Server } from '../../servers/server'
import { DestructiveRow } from '../parts/DestructiveRow'
import { DestructiveSection } from '../parts/DestructiveSection'
import { FactList } from '../parts/FactList'
import { RenameableTitle } from '../parts/RenameableTitle'
import { SettingsPageHead } from '../parts/SettingsPageHead'
import { SettingsSection } from '../parts/SettingsSection'
import styles from '../SettingsView.module.css'

/**
 * What a project *is* on this instance, what it is called, and the one
 * irreversible thing you can do to it.
 *
 * Since D51 a project is a record with a stable ULID and a mutable name, so the
 * name in the page title is the rename control.
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
    projectId.length > 0 && Claims.hasScopeWide(claims, Claims.RenamePermissions, project, '*')

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
            { label: server.name },
            { label: 'Projects', to: Routes.serverSettings(server.id, 'projects') },
            { label: project },
            { label: 'General' },
          ]}
        />

        <SettingsPageHead
          mono
          title={
            <RenameableTitle
              subject={{ noun: 'project', currentName: project, id: projectId }}
              allowed={canRename}
              rename={(name, dryRun) =>
                api.projects.rename(server.url, server.apiKey, project, name, projectId, dryRun)
              }
              onRenamed={onRenamed}
            />
          }
          sub="Renaming rewrites every claim naming this project. The id never changes."
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
              { key: 'Project ID', value: projectId || '—' },
              { key: 'API path', value: `/api/projects/${project}` },
              {
                key: 'Environments',
                value: environments.length ? environments.join(', ') : 'none',
                plain: true,
              },
            ]}
          />
        </SettingsSection>

        <DestructiveSection>
          <DestructiveRow
            title="Delete this project"
            blast={
              canDelete ? (
                <>
                  Deletes <strong>{project}</strong> and{' '}
                  {environments.length === 1
                    ? 'its 1 environment'
                    : `all ${environments.length} of its environments`}
                  , with every collection, schema and entry inside them.
                </>
              ) : (
                <>
                  This key cannot delete {project}. Deleting a project erases every collection in
                  every one of its environments, so it needs{' '}
                  {Claims.ForcedDeletePermissions.map((permission, index) => (
                    <span key={permission}>
                      {index > 0 && ' and '}
                      <code>{Claims.collection(project, '*', '*', permission)}</code>
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
              Delete project
            </Button>
          </DestructiveRow>
        </DestructiveSection>
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
          Everything under <b>{project}</b> is deleted permanently, across all of its environments.
          Keys scoped to this project keep their claims but will have nothing left to address.
        </DangerConfirm>
      )}
    </>
  )
}
