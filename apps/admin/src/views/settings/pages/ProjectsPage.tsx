import React, { useState } from 'react'
import { LoadingState } from '../../../components/feedback/LoadingState'
import { AlertTriangle, Folder, Plus } from 'lucide-react'
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
 * Every project on this instance, and creating one.
 *
 * An index, not a control panel: a row opens that project's settings rather
 * than acting on it in place. Deleting stays on the project's own page, where
 * the danger zone can say what is about to be lost and gate it on typing the
 * id — a delete button in a list is one stray click from taking a project's
 * every environment with it.
 */
export function ProjectsPage({
  server,
  projects,
  loading,
  claims,
  onChanged,
}: {
  server: Server
  projects: string[]
  loading: boolean
  claims: string[]
  onChanged: () => void
}) {
  const [isAdding, setIsAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const canCreate = Claims.hasAnyCollectionPermission(claims, Claims.CollectionCreate)

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    const project = draft.trim()
    if (!project) return
    if (!Claims.isScopeId(project)) {
      setError('Project name must start with a lowercase letter and use [a-z0-9_-], max 64 chars.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await api.projects.create(server.url, server.apiKey, project)
      setIsAdding(false)
      setDraft('')
      onChanged()
    } catch (caught: any) {
      setError(caught.message || 'Failed to create project')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <TopBar />

      <div className="content">
        <Breadcrumb crumbs={[{ label: server.name }, { label: 'Projects' }]} />

        <SettingsPageHead
          title="Projects"
          scope={{ kind: 'server' }}
          actions={
            canCreate &&
            !isAdding && (
              <Button variant="primary" onClick={() => setIsAdding(true)}>
                <Plus size={14} />
                <span>New project</span>
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
            <SettingsSection title="New project">
              <SettingsRow label="Name" htmlFor="new-project" help="Lowercase, [a-z0-9_-].">
                <input
                  id="new-project"
                  className={`${ledger.field} ${ledger.fieldMono}`}
                  type="text"
                  placeholder="ecommerce-api"
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
                  {busy ? 'Creating…' : 'Create project'}
                </Button>
              </div>
            </SettingsSection>
          </form>
        )}

        {loading ? (
          <LoadingState message="Loading projects…" />
        ) : (
          <SettingsList
            empty={`No projects on this server yet${canCreate ? ' — create one to get started.' : '.'}`}
          >
            {projects.map((project) => (
              <SettingsListRow
                key={project}
                to={Routes.projectSettings(server.id, project, 'general')}
                title={`Configure ${project}`}
                icon={<Folder size={14} />}
                name={project}
                meta={`/api/projects/${project}`}
              />
            ))}
          </SettingsList>
        )}
      </div>
    </>
  )
}
