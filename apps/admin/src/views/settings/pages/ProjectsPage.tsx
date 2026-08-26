import React, { useState } from 'react'
import { AlertTriangle, ChevronRight, FolderGit2, Plus } from 'lucide-react'
import { Claims } from '@silo/shared/claims'
import { Button } from '../../../components/buttons/Button'
import { Breadcrumb } from '../../../components/navigation/Breadcrumb'
import { api } from '../../../api/silo-api'
import { Link } from '../../../router/Link'
import { Routes } from '../../../router/routes'
import { TopBar } from '../../shell/TopBar'
import type { Server } from '../../servers/server'
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
        <Breadcrumb crumbs={[{ label: 'Projects' }]} />
        <div className="page-head">
          <div className="page-title-group">
            <h2 className="page-title">Projects</h2>
            <span className="page-sub">
              Root containers on this instance. Each holds its own environments, which in turn hold the
              collections and entries.
            </span>
          </div>
          {canCreate && !isAdding && (
            <div className="head-actions">
              <Button variant="primary" onClick={() => setIsAdding(true)}>
                <Plus size={14} />
                <span>New project</span>
              </Button>
            </div>
          )}
        </div>

        {error && (
          <div className={styles.alertError}>
            <AlertTriangle size={15} />
            <span>{error}</span>
          </div>
        )}

        {isAdding && (
          <form onSubmit={create} className={styles.createCard}>
            <div className={styles.createHeader}>
              <h3>New project</h3>
              <p>The id is fixed once created — it appears in every API path and claim naming it.</p>
            </div>
            <div className={styles.createFormRow}>
              <input
                type="text"
                placeholder="e.g. ecommerce-api"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                disabled={busy}
                autoFocus
                required
              />
              <div className={styles.createActions}>
                <Button type="button" variant="secondary" onClick={() => setIsAdding(false)} disabled={busy}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" disabled={busy || !draft.trim()}>
                  {busy ? 'Creating…' : 'Create project'}
                </Button>
              </div>
            </div>
          </form>
        )}

        <div className={styles.listContainer}>
          {loading ? (
            <div className={styles.loadingBox}>Loading projects…</div>
          ) : projects.length === 0 ? (
            <div className={styles.emptyBox}>
              No projects on this server yet{canCreate ? ' — create one to get started.' : '.'}
            </div>
          ) : (
            projects.map((project) => (
              <Link
                key={project}
                to={Routes.projectSettings(server.id, project, 'general')}
                className={`${styles.itemRow} ${styles.itemRowLink}`}
                title={`Configure ${project}`}
              >
                <div className={styles.itemMain}>
                  <div className={styles.itemAvatar}>
                    <FolderGit2 size={16} />
                  </div>
                  <div className={styles.itemInfo}>
                    <span className={styles.itemName}>{project}</span>
                    <span className={styles.itemMeta}>/api/projects/{project}</span>
                  </div>
                </div>
                <ChevronRight size={16} className={styles.itemChevron} />
              </Link>
            ))
          )}
        </div>
      </div>
    </>
  )
}
