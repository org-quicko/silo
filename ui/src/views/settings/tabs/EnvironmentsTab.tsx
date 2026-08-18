import React, { useEffect, useState } from 'react'
import { FolderGit2, Layers, Trash2, Plus, ExternalLink, AlertTriangle } from 'lucide-react'
import { Button } from '../../../components/Button'
import { TopBar } from '../../shell/TopBar'
import { api } from '../../../api/api-client'
import { router } from '../../../router/router'
import { Routes } from '../../../router/routes'
import { Claims } from '@silo/shared/claims'
import type { Server } from '../../servers/server'
import styles from '../SettingsView.module.css'

interface EnvironmentsTabProps {
  server: Server
  session: string
  onBack: () => void
}

export function EnvironmentsTab({ server, session, onBack }: EnvironmentsTabProps) {
  const [projects, setProjects] = useState<string[]>([])
  const [selectedProject, setSelectedProject] = useState<string>('default')
  const [environments, setEnvironments] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [isAdding, setIsAdding] = useState(false)
  const [newEnvName, setNewEnvName] = useState('')
  const [deletingEnv, setDeletingEnv] = useState<{ project: string; env: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const loadProjects = async () => {
    try {
      const list = await api.listProjects(server.url, server.apiKey)
      setProjects(list)
      if (list.length > 0 && !list.includes(selectedProject)) {
        setSelectedProject(list[0])
      }
    } catch {
      /* ignore */
    }
  }

  const loadEnvironments = async (proj: string) => {
    if (!proj) return
    setLoading(true)
    setError('')
    try {
      const list = await api.listEnvironments(server.url, server.apiKey, proj)
      setEnvironments(list)
    } catch (err: any) {
      setError(err.message || 'Failed to load environments')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadProjects()
  }, [server.url, server.apiKey])

  useEffect(() => {
    if (selectedProject) {
      loadEnvironments(selectedProject)
    }
  }, [server.url, server.apiKey, selectedProject])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedProject) return
    const env = newEnvName.trim()
    if (!env) return
    if (!Claims.isScopeId(env)) {
      setError('Environment name must start with lowercase letter and use [a-z0-9_-], max 64 chars.')
      return
    }

    setBusy(true)
    setError('')
    try {
      await api.createEnvironment(server.url, server.apiKey, selectedProject, env)
      setEnvironments((prev) => (prev.includes(env) ? prev : [...prev, env].sort()))
      setIsAdding(false)
      setNewEnvName('')
    } catch (err: any) {
      setError(err.message || 'Failed to create environment')
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async () => {
    if (!deletingEnv) return
    setBusy(true)
    setError('')
    try {
      await api.deleteEnvironment(server.url, server.apiKey, deletingEnv.project, deletingEnv.env, true)
      setEnvironments((prev) => prev.filter((e) => e !== deletingEnv.env))
      setDeletingEnv(null)
    } catch (err: any) {
      setError(err.message || 'Failed to delete environment')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <TopBar crumbs={[{ label: 'Admin' }, { label: 'Environments' }]} session={session} onLock={onBack}>
        {!isAdding && (
          <Button variant="primary" onClick={() => setIsAdding(true)}>
            <Plus size={14} />
            <span>Create environment</span>
          </Button>
        )}
      </TopBar>

      <div className="content">
        <div className="page-head">
          <div className="page-title-group">
            <h2 className="page-title">Environments</h2>
            <span className="page-sub">
              Manage isolated database environments (e.g. prod, staging, dev) per project.
            </span>
          </div>
        </div>

        {error && (
          <div className={styles.alertError}>
            <AlertTriangle size={15} />
            <span>{error}</span>
          </div>
        )}

        {/* Project selector tabs */}
        <div className={styles.projectTabs}>
          <span className={styles.tabsLabel}>Project:</span>
          <div className={styles.tabsList}>
            {projects.map((p) => (
              <button
                key={p}
                type="button"
                className={`${styles.tabBtn} ${p === selectedProject ? styles.tabActive : ''}`}
                onClick={() => setSelectedProject(p)}
              >
                <FolderGit2 size={13} />
                <span>{p}</span>
              </button>
            ))}
          </div>
        </div>

        {isAdding && (
          <form onSubmit={handleCreate} className={styles.createCard}>
            <div className={styles.createHeader}>
              <h3>Create New Environment in "{selectedProject}"</h3>
              <p>Enter an environment identifier such as prod, staging, or dev.</p>
            </div>
            <div className={styles.createFormRow}>
              <input
                type="text"
                placeholder="e.g. staging"
                value={newEnvName}
                onChange={(e) => setNewEnvName(e.target.value)}
                autoFocus
                required
              />
              <div className={styles.createActions}>
                <Button type="button" variant="secondary" onClick={() => setIsAdding(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" disabled={busy || !newEnvName.trim()}>
                  {busy ? 'Creating…' : 'Create Environment'}
                </Button>
              </div>
            </div>
          </form>
        )}

        <div className={styles.listContainer}>
          {loading ? (
            <div className={styles.loadingBox}>Loading environments for {selectedProject}…</div>
          ) : environments.length === 0 ? (
            <div className={styles.emptyBox}>
              No environments configured for project "{selectedProject}".
            </div>
          ) : (
            environments.map((env) => (
              <div key={env} className={styles.itemRow}>
                <div className={styles.itemMain}>
                  <div className={styles.itemAvatar}>
                    <Layers size={16} />
                  </div>
                  <div className={styles.itemInfo}>
                    <span className={styles.itemName}>{env}</span>
                    <span className={styles.itemMeta}>
                      Scope: {selectedProject}/{env}
                    </span>
                  </div>
                </div>

                <div className={styles.itemActions}>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => router.navigate(Routes.collections(server.id, selectedProject, env))}
                    title="Open in Workspace"
                  >
                    <ExternalLink size={13} />
                    <span>Open Workspace</span>
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    onClick={() => setDeletingEnv({ project: selectedProject, env })}
                    title="Delete environment"
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

      {deletingEnv && (
        <div className={styles.modalOverlay} onClick={() => !busy && setDeletingEnv(null)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div className={styles.modalIcon}>
                <AlertTriangle size={20} />
              </div>
              <div className={styles.modalHeadText}>
                <h3>Delete Environment</h3>
                <p>
                  Are you sure you want to delete environment <strong>{deletingEnv.project}/{deletingEnv.env}</strong> and all its collections? This action cannot be undone.
                </p>
              </div>
            </div>

            <div className={styles.modalActions}>
              <Button type="button" variant="secondary" disabled={busy} onClick={() => setDeletingEnv(null)}>
                Cancel
              </Button>
              <Button type="button" variant="danger" disabled={busy} onClick={handleDelete}>
                {busy ? 'Deleting…' : 'Delete Environment'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
