import React, { useState } from 'react'
import { LoadingState } from '../../../components/feedback/LoadingState'
import { AlertTriangle, Layers, Plus } from 'lucide-react'
import { Claims } from '@silo/shared/claims'
import { Button } from '../../../components/buttons/Button'
import { Breadcrumb } from '../../../components/navigation/Breadcrumb'
import { api } from '../../../api/silo-api'
import { Routes } from '../../../router/routes'
import { TopBar } from '../../shell/TopBar'
import type { Server } from '../../servers/server'
import { SettingsList } from '../parts/SettingsList'
import { SettingsListRow } from '../parts/SettingsListRow'
import { SettingsPageHead } from '../parts/SettingsPageHead'
import { SettingsRow } from '../parts/SettingsRow'
import { SettingsSection } from '../parts/SettingsSection'
import ledger from '../parts/SettingsLedger.module.css'
import styles from '../SettingsView.module.css'

/**
 * The environments of one project. The project is named by the URL, so this
 * page no longer carries a picker of its own — the nav's PROJECT switcher is
 * the single place context is chosen.
 */
export function ProjectEnvironmentsPage({
  server,
  project,
  environments,
  loading,
  claims,
  onChanged,
}: {
  server: Server
  project: string
  environments: string[]
  loading: boolean
  claims: string[]
  onChanged: () => void
}) {
  const [isAdding, setIsAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const canCreate = Claims.hasAnyCollectionPermission(claims, Claims.CollectionCreate, project, '*')

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    const env = draft.trim()
    if (!env) return
    if (!Claims.isScopeId(env)) {
      setError('Environment name must start with a lowercase letter and use [a-z0-9_-], max 64 chars.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await api.projects.createEnvironment(server.url, server.apiKey, project, env)
      setIsAdding(false)
      setDraft('')
      onChanged()
    } catch (caught: any) {
      setError(caught.message || 'Failed to create environment')
    } finally {
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
            { label: project, to: Routes.projectSettings(server.id, project, 'general') },
            { label: 'Environments' },
          ]}
        />

        <SettingsPageHead
          title="Environments"
          sub="Isolated copies of the collections and entries. Nothing is shared between them."
          actions={
            canCreate &&
            !isAdding && (
              <Button variant="primary" onClick={() => setIsAdding(true)}>
                <Plus size={14} />
                <span>New environment</span>
              </Button>
            )
          }
        />

        {error && (
          <div className={styles.alertError}>
            <AlertTriangle size={15} />
            <span>{error}</span>
          </div>
        )}

        {isAdding && (
          <form onSubmit={create}>
            <SettingsSection title={`New environment in ${project}`}>
              <SettingsRow
                label="Name"
                htmlFor="new-env"
                help="It starts empty — copy data in from Data Transfer."
              >
                <input
                  id="new-env"
                  className={`${ledger.field} ${ledger.fieldMono}`}
                  type="text"
                  placeholder="staging"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  disabled={busy}
                  autoFocus
                  required
                />
              </SettingsRow>
              <div className={ledger.sectionActions}>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setIsAdding(false)}
                  disabled={busy}
                >
                  Cancel
                </Button>
                <Button type="submit" variant="primary" disabled={busy || !draft.trim()}>
                  {busy ? 'Creating…' : 'Create environment'}
                </Button>
              </div>
            </SettingsSection>
          </form>
        )}

        {loading ? (
          <LoadingState message="Loading environments…" />
        ) : (
          <SettingsList
            empty={`No environments in ${project} yet${canCreate ? ' — create one to start adding collections.' : '.'}`}
          >
            {environments.map((env) => (
              <SettingsListRow
                key={env}
                to={Routes.envSettings(server.id, project, env, 'general')}
                title={`Configure ${project}/${env}`}
                icon={<Layers size={14} />}
                name={env}
                meta={`${project}/${env}`}
              />
            ))}
          </SettingsList>
        )}
      </div>
    </>
  )
}
