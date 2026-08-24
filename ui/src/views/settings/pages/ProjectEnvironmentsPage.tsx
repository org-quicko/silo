import React, { useState } from 'react'
import { AlertTriangle, ChevronRight, Layers, Plus } from 'lucide-react'
import { Claims } from '@silo/shared/claims'
import { Button } from '../../../components/Button'
import { Breadcrumb } from '../../../components/Breadcrumb'
import { api } from '../../../api/api-client'
import { Link } from '../../../router/Link'
import { Routes } from '../../../router/routes'
import { TopBar } from '../../shell/TopBar'
import { SmartSearch } from '../../search/SmartSearch'
import type { PaletteSeed } from '../../search/palette-seed'
import type { Server } from '../../servers/server'
import styles from '../SettingsView.module.css'
import type { SessionBadge } from '../../shell/session-badge'

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
  session,
  smartCollections,
  onOpenPalette,
  onNavigateToCollection,
  onChanged,
}: {
  server: Server
  project: string
  environments: string[]
  loading: boolean
  claims: string[]
  session: SessionBadge
  smartCollections: readonly { name: string; count: number | null; schema?: any }[]
  onOpenPalette: (seed: PaletteSeed) => void
  onNavigateToCollection: (name: string, q: string) => void
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
      await api.createEnvironment(server.url, server.apiKey, project, env)
      setIsAdding(false)
      setDraft('')
      onChanged()
    } catch (err: any) {
      setError(err.message || 'Failed to create environment')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <TopBar
        search={
          <SmartSearch
            serverId={server.id}
            scope={null}
            collection={null}
            collections={smartCollections}
            onNavigateToCollection={onNavigateToCollection}
            onOpenPalette={onOpenPalette}
          />
        }
        session={session}
      >
        {canCreate && !isAdding && (
          <Button variant="primary" onClick={() => setIsAdding(true)}>
            <Plus size={14} />
            <span>New environment</span>
          </Button>
        )}
      </TopBar>

      <div className="content">
        <Breadcrumb
          crumbs={[
            { label: project, to: Routes.projectSettings(server.id, project, 'general') },
            { label: 'Environments' },
          ]}
        />
        <div className="page-head">
          <div className="page-title-group">
            <h2 className="page-title">Environments</h2>
            <span className="page-sub">
              Isolated copies of <b>{project}</b>'s collections and entries — typically prod, staging and
              dev. Nothing is shared between them except the server itself.
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
          <form onSubmit={create} className={styles.createCard}>
            <div className={styles.createHeader}>
              <h3>New environment in {project}</h3>
              <p>It starts empty — copy data into it from Environment → Data Transfer.</p>
            </div>
            <div className={styles.createFormRow}>
              <input
                type="text"
                placeholder="e.g. staging"
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
                  {busy ? 'Creating…' : 'Create environment'}
                </Button>
              </div>
            </div>
          </form>
        )}

        <div className={styles.listContainer}>
          {loading ? (
            <div className={styles.loadingBox}>Loading environments…</div>
          ) : environments.length === 0 ? (
            <div className={styles.emptyBox}>
              No environments in {project} yet{canCreate ? ' — create one to start adding collections.' : '.'}
            </div>
          ) : (
            environments.map((env) => (
              <Link
                key={env}
                to={Routes.envSettings(server.id, project, env, 'general')}
                className={`${styles.itemRow} ${styles.itemRowLink}`}
                title={`Configure ${project}/${env}`}
              >
                <div className={styles.itemMain}>
                  <div className={styles.itemAvatar}>
                    <Layers size={16} />
                  </div>
                  <div className={styles.itemInfo}>
                    <span className={styles.itemName}>{env}</span>
                    <span className={styles.itemMeta}>
                      {project}/{env}
                    </span>
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
