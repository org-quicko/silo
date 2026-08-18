import React, { useEffect, useState } from 'react'
import { FolderGit2, Layers, Trash2, Plus, AlertTriangle } from 'lucide-react'
import { Button } from '../../../components/Button'
import { TopBar } from '../../shell/TopBar'
import { api } from '../../../api/api-client'
import { router } from '../../../router/router'
import { Routes } from '../../../router/routes'
import { Claims } from '@silo/shared/claims'
import type { Server } from '../../servers/server'
import styles from '../SettingsView.module.css'

interface ProjectsTabProps {
  server: Server
  session: string
  onBack: () => void
}

export function ProjectsTab({ server, session, onBack }: ProjectsTabProps) {
  const [projects, setProjects] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [isAdding, setIsAdding] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [deletingProject, setDeletingProject] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const loadProjects = async () => {
    setLoading(true)
    setError('')
    try {
      const list = await api.listProjects(server.url, server.apiKey)
      setProjects(list)
    } catch (err: any) {
      setError(err.message || 'Failed to load projects')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadProjects()
  }, [server.url, server.apiKey])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    const p = newProjectName.trim()
    if (!p) return
    if (!Claims.isScopeId(p)) {
      setError('Project name must start with lowercase letter and use [a-z0-9_-], max 64 chars.')
      return
    }

    setBusy(true)
    setError('')
    try {
      await api.createProject(server.url, server.apiKey, p)
      setProjects((prev) => (prev.includes(p) ? prev : [...prev, p].sort()))
      setIsAdding(false)
      setNewProjectName('')
    } catch (err: any) {
      setError(err.message || 'Failed to create project')
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async () => {
    if (!deletingProject) return
    setBusy(true)
    setError('')
    try {
      await api.deleteProject(server.url, server.apiKey, deletingProject, true)
      setProjects((prev) => prev.filter((p) => p !== deletingProject))
      setDeletingProject(null)
    } catch (err: any) {
      setError(err.message || 'Failed to delete project')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <TopBar crumbs={[{ label: 'Admin' }, { label: 'Projects' }]} session={session} onLock={onBack}>
        {!isAdding && (
          <Button variant="primary" onClick={() => setIsAdding(true)}>
            <Plus size={14} />
            <span>Create project</span>
          </Button>
        )}
      </TopBar>

      <div className="content">
        <div className="page-head">
          <div className="page-title-group">
            <h2 className="page-title">Projects</h2>
            <span className="page-sub">
              Projects are root containers for environments and collections hosted on this Silo instance.
            </span>
          </div>
        </div>

        {error && (
          <div className={styles.alertError}>
            <AlertTriangle size={15} />
            <span>{error}</span>
          </div>
        )}

        {isAdding && (
          <form onSubmit={handleCreate} className={styles.createCard}>
            <div className={styles.createHeader}>
              <h3>Create New Project</h3>
              <p>Enter a unique lowercase identifier for this project.</p>
            </div>
            <div className={styles.createFormRow}>
              <input
                type="text"
                placeholder="e.g. ecommerce-api"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                autoFocus
                required
              />
              <div className={styles.createActions}>
                <Button type="button" variant="secondary" onClick={() => setIsAdding(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" disabled={busy || !newProjectName.trim()}>
                  {busy ? 'Creating…' : 'Create Project'}
                </Button>
              </div>
            </div>
          </form>
        )}

        <div className={styles.listContainer}>
          {loading ? (
            <div className={styles.loadingBox}>Loading projects…</div>
          ) : projects.length === 0 ? (
            <div className={styles.emptyBox}>No projects found. Click "Create project" to add one.</div>
          ) : (
            projects.map((p) => (
              <div key={p} className={styles.itemRow}>
                <div className={styles.itemMain}>
                  <div className={styles.itemAvatar}>
                    <FolderGit2 size={16} />
                  </div>
                  <div className={styles.itemInfo}>
                    <span className={styles.itemName}>{p}</span>
                    <span className={styles.itemMeta}>Project</span>
                  </div>
                </div>

                <div className={styles.itemActions}>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => router.navigate(Routes.settingsEnvironments(server.id))}
                    title="Manage environments"
                  >
                    <Layers size={13} />
                    <span>Environments</span>
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    onClick={() => setDeletingProject(p)}
                    title="Delete project"
                  >
                    <Trash2 size={13} />
                    <span>Delete</span>
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {deletingProject && (
        <div className={styles.modalOverlay} onClick={() => !busy && setDeletingProject(null)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div className={styles.modalIcon}>
                <AlertTriangle size={20} />
              </div>
              <div className={styles.modalHeadText}>
                <h3>Delete Project</h3>
                <p>
                  Are you sure you want to delete project <strong>{deletingProject}</strong> and all its environments and collections? This action cannot be undone.
                </p>
              </div>
            </div>

            <div className={styles.modalActions}>
              <Button type="button" variant="secondary" disabled={busy} onClick={() => setDeletingProject(null)}>
                Cancel
              </Button>
              <Button type="button" variant="danger" disabled={busy} onClick={handleDelete}>
                {busy ? 'Deleting…' : 'Delete Project'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
