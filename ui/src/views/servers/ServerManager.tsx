import React, { useEffect, useState } from 'react'
import { Plus, ChevronRight, Eye, EyeOff, Globe, Server as ServerIcon, FolderGit2, Layers, Check, ArrowRight, Settings } from 'lucide-react'
import { SiloMark } from '../../components/SiloMark'
import { Button } from '../../components/Button'
import passwordStyles from '../../components/PasswordInput.module.css'
import { Claims } from '@silo/shared/claims'
import { api } from '../../api/api-client'
import type { Server } from './server'
import styles from './ServerManager.module.css'

interface ServerManagerProps {
  servers: Server[]
  onConnect: (serverId: string, project: string, env: string) => void
  onAddServer: (server: Server) => void
  onOpenStatus: (serverId: string) => void
  initialServerId?: string | null
  initialProject?: string | null
  initialEnv?: string | null
  onClose?: () => void
}

export function ServerManager({
  servers,
  onConnect,
  onAddServer,
  onOpenStatus,
  initialServerId,
  initialProject,
  initialEnv,
  onClose,
}: ServerManagerProps) {
  const [selectedServerId, setSelectedServerId] = useState<string | null>(() => initialServerId ?? null)
  const [selectedProject, setSelectedProject] = useState<string | null>(() => initialProject ?? null)
  const [selectedEnv, setSelectedEnv] = useState<string | null>(() => initialEnv ?? null)

  const [projects, setProjects] = useState<string[]>([])
  const [environments, setEnvironments] = useState<string[]>([])
  const [loadingProjects, setLoadingProjects] = useState(false)
  const [loadingEnvs, setLoadingEnvs] = useState(false)

  // Add Server Modal State
  const [isAddingServer, setIsAddingServer] = useState(false)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [serverError, setServerError] = useState('')
  const [serverLoading, setServerLoading] = useState(false)

  // Inline creation states
  const [isAddingProject, setIsAddingProject] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [isAddingEnv, setIsAddingEnv] = useState(false)
  const [newEnvName, setNewEnvName] = useState('')
  const [columnError, setColumnError] = useState('')

  const selectedServer = servers.find((s) => s.id === selectedServerId) || null

  useEffect(() => {
    if (!onClose) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isAddingServer) {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, isAddingServer])

  const handleSelectServer = (id: string) => {
    if (selectedServerId === id) return
    setSelectedServerId(id)
    setSelectedProject(null)
    setSelectedEnv(null)
    setEnvironments([])
    setIsAddingProject(false)
    setIsAddingEnv(false)
    setColumnError('')
  }

  const handleSelectProject = (p: string) => {
    if (selectedProject === p) return
    setSelectedProject(p)
    setSelectedEnv(null)
    setIsAddingEnv(false)
    setColumnError('')
  }

  // Fetch projects when selectedServer changes
  useEffect(() => {
    if (!selectedServer) {
      setProjects([])
      setSelectedProject(null)
      setEnvironments([])
      setSelectedEnv(null)
      return
    }

    let cancelled = false
    setLoadingProjects(true)
    setColumnError('')
    api
      .listProjects(selectedServer.url, selectedServer.apiKey)
      .then((items) => {
        if (cancelled) return
        setProjects(items)
      })
      .catch((err: any) => {
        if (cancelled) return
        setProjects([])
        setColumnError(err.message || 'Failed to load projects')
      })
      .finally(() => {
        if (!cancelled) setLoadingProjects(false)
      })

    return () => {
      cancelled = true
    }
  }, [selectedServerId, selectedServer?.url, selectedServer?.apiKey])

  // Fetch environments when selectedProject changes
  useEffect(() => {
    if (!selectedServer || !selectedProject) {
      setEnvironments([])
      setSelectedEnv(null)
      return
    }

    let cancelled = false
    setLoadingEnvs(true)
    setColumnError('')
    api
      .listEnvironments(selectedServer.url, selectedServer.apiKey, selectedProject)
      .then((items) => {
        if (cancelled) return
        setEnvironments(items)
      })
      .catch((err: any) => {
        if (cancelled) return
        setEnvironments([])
        setColumnError(err.message || 'Failed to load environments')
      })
      .finally(() => {
        if (!cancelled) setLoadingEnvs(false)
      })

    return () => {
      cancelled = true
    }
  }, [selectedServerId, selectedProject, selectedServer?.url, selectedServer?.apiKey])

  const handleAddServer = async (e: React.FormEvent) => {
    e.preventDefault()
    setServerError('')

    const trimmedName = name.trim()
    let trimmedUrl = url.trim()
    const trimmedKey = apiKey.trim()

    if (!trimmedName || !trimmedUrl || !trimmedKey) {
      setServerError('Please fill in all required fields.')
      return
    }

    if (!trimmedUrl.startsWith('http://') && !trimmedUrl.startsWith('https://')) {
      trimmedUrl = 'http://' + trimmedUrl
    }

    setServerLoading(true)
    try {
      const verifyRes = await api.verify(trimmedUrl, trimmedKey)
      if (verifyRes.ok) {
        const newServer: Server = {
          id: Math.random().toString(36).substring(2, 11),
          name: trimmedName,
          url: trimmedUrl,
          apiKey: trimmedKey,
        }
        onAddServer(newServer)
        setSelectedServerId(newServer.id)
        setIsAddingServer(false)
      } else {
        setServerError('Verification failed: Invalid API key.')
      }
    } catch (err: any) {
      setServerError(`Failed to connect: ${err.message || 'Connection refused.'}`)
    } finally {
      setServerLoading(false)
    }
  }

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedServer) return
    const p = newProjectName.trim()
    if (!p) return
    if (!Claims.isScopeId(p)) {
      setColumnError('Project name must start with lowercase letter and use [a-z0-9_-], max 64 chars.')
      return
    }

    try {
      await api.createProject(selectedServer.url, selectedServer.apiKey, p)
      setProjects((prev) => (prev.includes(p) ? prev : [...prev, p].sort()))
      setSelectedProject(p)
      setIsAddingProject(false)
      setNewProjectName('')
    } catch (err: any) {
      setColumnError(err.message || 'Failed to create project')
    }
  }

  const handleCreateEnv = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedServer || !selectedProject) return
    const env = newEnvName.trim()
    if (!env) return
    if (!Claims.isScopeId(env)) {
      setColumnError('Environment name must start with lowercase letter and use [a-z0-9_-], max 64 chars.')
      return
    }

    try {
      await api.createEnvironment(selectedServer.url, selectedServer.apiKey, selectedProject, env)
      setEnvironments((prev) => (prev.includes(env) ? prev : [...prev, env].sort()))
      setSelectedEnv(env)
      setIsAddingEnv(false)
      setNewEnvName('')
    } catch (err: any) {
      setColumnError(err.message || 'Failed to create environment')
    }
  }

  const handleConnect = () => {
    if (selectedServer && selectedProject && selectedEnv) {
      onConnect(selectedServer.id, selectedProject, selectedEnv)
    }
  }

  const content = (
    <div className={styles.window} onMouseDown={(e) => e.stopPropagation()}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.brand}>
          <div className={styles.logo}>
            <SiloMark size={28} stroke="var(--accent)" />
          </div>
          <div className={styles.brandText}>
            <h1>Silo CMS</h1>
            <span className={styles.badge}>Server Browser</span>
          </div>
        </div>
        <div className={styles.headerActions}>
          <Button
            type="button"
            variant="primary"
            onClick={() => {
              setName('')
              setUrl('')
              setApiKey('')
              setServerError('')
              setIsAddingServer(true)
            }}
          >
            <Plus size={15} /> Add Server
          </Button>
          {onClose && (
            <button
              type="button"
              className={styles.closeBtn}
              onClick={onClose}
              title="Close (Esc)"
              aria-label="Close"
            >
              ×
            </button>
          )}
        </div>
      </header>

      {columnError && (
        <div className={styles.bannerError}>
          <span>{columnError}</span>
          <button type="button" onClick={() => setColumnError('')}>×</button>
        </div>
      )}

      {/* Multi-pane Columns (Ranger / macOS Columns View) */}
      <div className={styles.columnsContainer}>
        {/* Column 1: Servers */}
        <div className={`${styles.column} ${styles.columnActive}`}>
          <div className={styles.columnHeader}>
            <div className={styles.columnTitle}>
              <ServerIcon size={14} className={styles.columnIcon} />
              <span>Servers</span>
              <span className={styles.counter}>{servers.length}</span>
            </div>
          </div>
          <div className={styles.columnList}>
            {servers.length === 0 ? (
              <div className={styles.emptyColumn}>
                <Globe size={22} className={styles.emptyIcon} />
                <span>No servers configured</span>
                <small className="muted">Click "Add Server" above to connect</small>
              </div>
            ) : (
              servers.map((s, idx) => {
                const isSelected = s.id === selectedServerId
                return (
                  <div
                    key={s.id}
                    className={`${styles.columnItem} ${isSelected ? styles.selected : ''}`}
                    onClick={() => handleSelectServer(s.id)}
                    style={{ animationDelay: `${idx * 30}ms` }}
                  >
                    <div className={styles.itemMain}>
                      <span className={styles.itemTitle}>{s.name}</span>
                      <span className={styles.itemSubtitle}>{s.url}</span>
                    </div>
                    <button
                      type="button"
                      className={styles.itemSettings}
                      onClick={(e) => {
                        e.stopPropagation()
                        onOpenStatus(s.id)
                      }}
                      title="Server status & configuration"
                    >
                      <Settings size={13} />
                    </button>
                    <ChevronRight size={14} className={styles.chevron} />
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* Column 2: Projects */}
        <div className={`${styles.column} ${selectedServer ? styles.columnActive : styles.columnInactive}`}>
          <div className={styles.columnHeader}>
            <div className={styles.columnTitle}>
              <FolderGit2 size={14} className={styles.columnIcon} />
              <span>Projects</span>
              {selectedServer && <span className={styles.counter}>{projects.length}</span>}
            </div>
            {selectedServer && !isAddingProject && (
              <button
                type="button"
                className={styles.headerBtn}
                onClick={() => {
                  setIsAddingProject(true)
                  setNewProjectName('')
                }}
                title="New project"
              >
                <Plus size={14} />
              </button>
            )}
          </div>
          <div className={styles.columnList}>
            {!selectedServer ? (
              <div className={styles.emptyColumn}>
                <FolderGit2 size={22} className={styles.emptyIcon} />
                <span>Select a server</span>
                <small className="muted">Projects will appear here</small>
              </div>
            ) : loadingProjects ? (
              <div className={styles.emptyColumn}>
                <div className={styles.spinner} />
                <span>Loading projects…</span>
              </div>
            ) : (
              <div className={styles.animatedList} key={selectedServerId}>
                {isAddingProject && (
                  <form onSubmit={handleCreateProject} className={styles.inlineForm}>
                    <input
                      type="text"
                      placeholder="project-name"
                      value={newProjectName}
                      onChange={(e) => setNewProjectName(e.target.value)}
                      autoFocus
                    />
                    <div className={styles.inlineActions}>
                      <button type="submit" className={styles.inlineSubmit} title="Create">
                        <Check size={13} />
                      </button>
                      <button
                        type="button"
                        className={styles.inlineCancel}
                        onClick={() => setIsAddingProject(false)}
                        title="Cancel"
                      >
                        ×
                      </button>
                    </div>
                  </form>
                )}
                {projects.length === 0 && !isAddingProject ? (
                  <div className={styles.emptyColumn}>
                    <span>No projects found</span>
                    <small className="muted">Click + to create one</small>
                  </div>
                ) : (
                  projects.map((p, idx) => {
                    const isSelected = p === selectedProject
                    return (
                      <div
                        key={p}
                        className={`${styles.columnItem} ${isSelected ? styles.selected : ''}`}
                        onClick={() => handleSelectProject(p)}
                        style={{ animationDelay: `${idx * 25}ms` }}
                      >
                        <div className={styles.itemMain}>
                          <span className={styles.itemTitle}>{p}</span>
                        </div>
                        <ChevronRight size={14} className={styles.chevron} />
                      </div>
                    )
                  })
                )}
              </div>
            )}
          </div>
        </div>

        {/* Column 3: Environments */}
        <div className={`${styles.column} ${selectedProject ? styles.columnActive : styles.columnInactive}`}>
          <div className={styles.columnHeader}>
            <div className={styles.columnTitle}>
              <Layers size={14} className={styles.columnIcon} />
              <span>Environments</span>
              {selectedProject && <span className={styles.counter}>{environments.length}</span>}
            </div>
            {selectedProject && !isAddingEnv && (
              <button
                type="button"
                className={styles.headerBtn}
                onClick={() => {
                  setIsAddingEnv(true)
                  setNewEnvName('')
                }}
                title="New environment"
              >
                <Plus size={14} />
              </button>
            )}
          </div>
          <div className={styles.columnList}>
            {!selectedServer ? (
              <div className={styles.emptyColumn}>
                <Layers size={22} className={styles.emptyIcon} />
                <span>Select a server</span>
              </div>
            ) : !selectedProject ? (
              <div className={styles.emptyColumn}>
                <Layers size={22} className={styles.emptyIcon} />
                <span>Select a project</span>
                <small className="muted">Environments will appear here</small>
              </div>
            ) : loadingEnvs ? (
              <div className={styles.emptyColumn}>
                <div className={styles.spinner} />
                <span>Loading environments…</span>
              </div>
            ) : (
              <div className={styles.animatedList} key={`${selectedServerId}:${selectedProject}`}>
                {isAddingEnv && (
                  <form onSubmit={handleCreateEnv} className={styles.inlineForm}>
                    <input
                      type="text"
                      placeholder="env-name"
                      value={newEnvName}
                      onChange={(e) => setNewEnvName(e.target.value)}
                      autoFocus
                    />
                    <div className={styles.inlineActions}>
                      <button type="submit" className={styles.inlineSubmit} title="Create">
                        <Check size={13} />
                      </button>
                      <button
                        type="button"
                        className={styles.inlineCancel}
                        onClick={() => setIsAddingEnv(false)}
                        title="Cancel"
                      >
                        ×
                      </button>
                    </div>
                  </form>
                )}
                {environments.length === 0 && !isAddingEnv ? (
                  <div className={styles.emptyColumn}>
                    <span>No environments found</span>
                    <small className="muted">Click + to create one</small>
                  </div>
                ) : (
                  environments.map((env, idx) => {
                    const isSelected = env === selectedEnv
                    return (
                      <div
                        key={env}
                        className={`${styles.columnItem} ${isSelected ? styles.selected : ''}`}
                        onClick={() => setSelectedEnv(env)}
                        onDoubleClick={handleConnect}
                        style={{ animationDelay: `${idx * 25}ms` }}
                      >
                        <div className={styles.itemMain}>
                          <span className={styles.itemTitle}>{env}</span>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer / Connection Bar */}
      <footer className={styles.footer}>
        <div className={styles.breadcrumb}>
          <span className={`${styles.breadcrumbItem} ${selectedServer ? styles.breadcrumbItemActive : ''}`}>
            {selectedServer ? selectedServer.name : 'Select server'}
          </span>
          <span className={styles.breadcrumbSep}>›</span>
          <span className={`${styles.breadcrumbItem} ${selectedProject ? styles.breadcrumbItemActive : ''}`}>
            {selectedProject || 'Select project'}
          </span>
          <span className={styles.breadcrumbSep}>›</span>
          <span className={`${styles.breadcrumbItem} ${selectedEnv ? styles.breadcrumbItemActive : ''}`}>
            {selectedEnv || 'Select environment'}
          </span>
        </div>

        <Button
          type="button"
          variant="primary"
          disabled={!selectedServer || !selectedProject || !selectedEnv}
          onClick={handleConnect}
          className={styles.connectBtn}
        >
          <span>Open Workspace</span>
          <ArrowRight size={15} />
        </Button>
      </footer>
    </div>
  )

  return (
    <>
      {onClose ? (
        <div className={styles.modalBackdrop} onMouseDown={onClose}>
          {content}
        </div>
      ) : (
        <div className={styles.gate}>
          <div className={styles.glow} />
          {content}
        </div>
      )}

      {/* Add Server Modal */}
      {isAddingServer && (
        <div
          className={styles.modalOverlay}
          onClick={() => setIsAddingServer(false)}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2>Add Silo Server</h2>
              <button
                type="button"
                className={styles.modalClose}
                onClick={() => setIsAddingServer(false)}
              >
                ×
              </button>
            </div>
            <p className={styles.modalSubtitle}>
              Enter connection details for your running Silo server.
            </p>

            <form onSubmit={handleAddServer} className={styles.modalForm}>
              <div className={styles.inputGroup}>
                <label htmlFor="server-name">
                  Server Name <span className={styles.required}>*</span>
                </label>
                <input
                  id="server-name"
                  type="text"
                  placeholder="e.g. Local Dev"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={serverLoading}
                  required
                  autoFocus
                />
              </div>

              <div className={styles.inputGroup}>
                <label htmlFor="server-url">
                  Server URL <span className={styles.required}>*</span>
                </label>
                <input
                  id="server-url"
                  type="text"
                  placeholder="e.g. http://localhost:8090"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  disabled={serverLoading}
                  required
                />
              </div>

              <div className={styles.inputGroup}>
                <label htmlFor="server-key">
                  API Key <span className={styles.required}>*</span>
                </label>
                <div className={passwordStyles.wrapper}>
                  <input
                    id="server-key"
                    type={showKey ? 'text' : 'password'}
                    placeholder="silo_..."
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    disabled={serverLoading}
                    required
                  />
                  <button
                    type="button"
                    className={passwordStyles.toggle}
                    onClick={() => setShowKey(!showKey)}
                    title={showKey ? 'Hide key' : 'Show key'}
                  >
                    {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              {serverError && (
                <div className={styles.modalError}>
                  <span>{serverError}</span>
                </div>
              )}

              <div className={styles.modalActions}>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setIsAddingServer(false)}
                  disabled={serverLoading}
                >
                  Cancel
                </Button>
                <Button type="submit" variant="primary" disabled={serverLoading}>
                  {serverLoading ? 'Connecting...' : 'Add Server'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}

