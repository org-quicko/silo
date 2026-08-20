import { useEffect, useState } from 'react'
import { AlertTriangle, ArrowRight, Check, Copy, RefreshCw } from 'lucide-react'
import { Claims } from '@silo/shared/claims'
import { Button } from '../../../components/Button'
import { StatRow } from '../../../components/StatRow'
import { StatTile } from '../../../components/StatTile'
import { api } from '../../../api/api-client'
import { Routes } from '../../../router/routes'
import type { ImportResult } from '../../../api/types/import-result'
import type { ScopeRef } from '../../../api/types/scope-ref'
import { TopBar } from '../../shell/TopBar'
import type { Server } from '../../servers/server'
import settings from '../SettingsView.module.css'
import styles from './EnvTransferPage.module.css'
import type { SessionBadge } from '../../shell/session-badge'

type Mode = 'merge' | 'replace'
type Prefer = '' | 'local' | 'remote'

/**
 * Copy another environment's contents into this one.
 *
 * Scoped, unlike Server → Data Transfer: this moves one (project, env) onto
 * another inside the same instance and needs only the scoped claims a
 * read-then-write loop would (D22). The whole-instance archive lives under the
 * server, where its blast radius is stated.
 */
export function EnvTransferPage({
  server,
  scope,
  projects,
  claims,
  session,
}: {
  server: Server
  /** The destination — the environment whose settings these are. */
  scope: ScopeRef
  projects: string[]
  claims: string[]
  session: SessionBadge
}) {
  const [sourceProject, setSourceProject] = useState(scope.project)
  const [sourceEnvs, setSourceEnvs] = useState<string[]>([])
  const [sourceEnv, setSourceEnv] = useState('')
  const [mode, setMode] = useState<Mode>('merge')
  const [prefer, setPrefer] = useState<Prefer>('')
  const [preview, setPreview] = useState<ImportResult | null>(null)
  const [applied, setApplied] = useState<ImportResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const invalidate = () => {
    setPreview(null)
    setApplied(null)
    setError('')
  }

  // Default to a sibling environment: copying within a project is the common
  // case, and the destination itself is never a valid source.
  useEffect(() => {
    let alive = true
    api
      .listEnvironments(server.url, server.apiKey, sourceProject)
      .then((envs) => {
        if (!alive) return
        const eligible = envs.filter((e) => !(sourceProject === scope.project && e === scope.env))
        setSourceEnvs(eligible)
        setSourceEnv((current) => (eligible.includes(current) ? current : eligible[0] || ''))
      })
      .catch((err: any) => {
        if (!alive) return
        setSourceEnvs([])
        setSourceEnv('')
        setError(err.message || 'Failed to load environments')
      })
    return () => {
      alive = false
    }
  }, [server.url, server.apiKey, sourceProject, scope.project, scope.env])

  const from: ScopeRef | null = sourceEnv ? { project: sourceProject, env: sourceEnv } : null
  const canRead = from && Claims.hasScopeWide(claims, Claims.ScopeCopyReadPermissions, from.project, from.env)
  const canWrite = Claims.hasScopeWide(claims, Claims.ScopeCopyWritePermissions, scope.project, scope.env)
  const canReplace = Claims.hasScopeWide(claims, Claims.ScopeCopyReplacePermissions, scope.project, scope.env)
  const allowed = !!canRead && canWrite && (mode === 'merge' || canReplace)

  const run = async (dryRun: boolean) => {
    if (!from) return
    setBusy(true)
    setError('')
    if (dryRun) invalidate()
    try {
      const result = await api.copyScope(server.url, server.apiKey, scope, { from, mode, prefer, dryRun })
      if (dryRun) setPreview(result)
      else {
        setApplied(result)
        setPreview(null)
      }
    } catch (err: any) {
      setError(err.message || (dryRun ? 'Preview failed' : 'Copy failed'))
    } finally {
      setBusy(false)
    }
  }

  const result = applied || preview

  return (
    <>
      <TopBar
        crumbs={[
          { label: scope.project, to: Routes.projectSettings(server.id, scope.project, 'general') },
          { label: scope.env, to: Routes.envSettings(server.id, scope.project, scope.env, 'general') },
          { label: 'Data Transfer' },
        ]}
        session={session}
      />

      <div className="content">
        <div className="page-head">
          <div className="page-title-group">
            <h2 className="page-title">Data Transfer</h2>
            <span className="page-sub">
              Copy collections, schemas and entries from another environment into{' '}
              <b>{scope.project}/{scope.env}</b>. Preview first — nothing is written until you apply.
            </span>
          </div>
        </div>

        {error && (
          <div className={settings.alertError}>
            <AlertTriangle size={15} />
            <span>{error}</span>
          </div>
        )}

        <div className={settings.generalContent}>
          <section className={styles.panel}>
            <div className={styles.header}>
              <span className={styles.heading}>
                <Copy size={15} /> Copy from another environment
              </span>
              <p>
                Runs entirely on the server — no archive is downloaded. Media is stored per instance rather
                than per environment, so files in the media library are shared already and none are copied.
              </p>
            </div>

            <div className={styles.body}>
              <div className={styles.sourceGrid}>
                <div className="field">
                  <label className="field-label" htmlFor="src-project">
                    Source project
                  </label>
                  <select
                    id="src-project"
                    className="input"
                    value={sourceProject}
                    onChange={(e) => {
                      setSourceProject(e.target.value)
                      invalidate()
                    }}
                    disabled={busy}
                  >
                    {projects.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="field">
                  <label className="field-label" htmlFor="src-env">
                    Source environment
                  </label>
                  <select
                    id="src-env"
                    className="input"
                    value={sourceEnv}
                    onChange={(e) => {
                      setSourceEnv(e.target.value)
                      invalidate()
                    }}
                    disabled={busy || sourceEnvs.length === 0}
                  >
                    {sourceEnvs.length === 0 && <option value="">No other environment</option>}
                    {sourceEnvs.map((e) => (
                      <option key={e} value={e}>
                        {e}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="field">
                  <label className="field-label" htmlFor="copy-mode">
                    Mode
                  </label>
                  <select
                    id="copy-mode"
                    className="input"
                    value={mode}
                    onChange={(e) => {
                      setMode(e.target.value as Mode)
                      invalidate()
                    }}
                    disabled={busy}
                  >
                    <option value="merge">Merge</option>
                    <option value="replace">Replace source collections</option>
                  </select>
                </div>

                {mode === 'merge' && (
                  <div className="field">
                    <label className="field-label" htmlFor="copy-prefer">
                      On conflicts
                    </label>
                    <select
                      id="copy-prefer"
                      className="input"
                      value={prefer}
                      onChange={(e) => {
                        setPrefer(e.target.value as Prefer)
                        invalidate()
                      }}
                      disabled={busy}
                    >
                      <option value="">Newest wins</option>
                      <option value="local">Keep this environment</option>
                      <option value="remote">Use the source</option>
                    </select>
                  </div>
                )}
              </div>

              <div className={styles.direction}>
                <span className={styles.scopeFrom}>
                  {from ? `${from.project}/${from.env}` : '—'}
                </span>
                <ArrowRight size={15} className={styles.arrow} />
                <span className={styles.scopeTo}>
                  {scope.project}/{scope.env}
                </span>
              </div>

              {mode === 'replace' && (
                <div className="banner banner-warn">
                  <AlertTriangle size={15} />
                  <span>
                    Every collection the source carries is emptied in {scope.env} before it is written.
                    Collections that exist only here are left alone.
                  </span>
                </div>
              )}

              {from && !canRead && (
                <div className="banner banner-bad">
                  <AlertTriangle size={15} />
                  <span>
                    This key cannot read all of {from.project}/{from.env} — it is missing{' '}
                    <code>{Claims.collection(from.project, from.env, '*', Claims.CollectionEntriesRead)}</code>.
                  </span>
                </div>
              )}

              {!canWrite && (
                <div className="banner banner-bad">
                  <AlertTriangle size={15} />
                  <span>
                    This key cannot write all of {scope.project}/{scope.env} — it is missing{' '}
                    <code>{Claims.collection(scope.project, scope.env, '*', Claims.CollectionEntriesCreate)}</code>.
                  </span>
                </div>
              )}

              {mode === 'replace' && canWrite && !canReplace && (
                <div className="banner banner-bad">
                  <AlertTriangle size={15} />
                  <span>
                    Replace mode additionally needs{' '}
                    <code>{Claims.collection(scope.project, scope.env, '*', Claims.CollectionEntriesDelete)}</code>.
                  </span>
                </div>
              )}

              {busy && (
                <div className={styles.progress}>
                  <RefreshCw size={14} className="spin" />
                  {preview ? 'Copying…' : 'Comparing the two environments…'}
                </div>
              )}

              {result && (
                <>
                  <StatRow>
                    <StatTile n={result.added} label="to create" tone="ok" prefix="+" />
                    <StatTile n={result.updated} label="to update" tone="warn" prefix="~" />
                    <StatTile n={result.deleted} label="to delete" tone="bad" />
                    <StatTile n={result.skipped} label="unchanged" tone="muted" />
                  </StatRow>
                  {applied && (
                    <div className="banner banner-ok">
                      <Check size={15} />
                      <span>
                        Copied into {scope.env} in <b>{applied.mode}</b> mode.
                      </span>
                    </div>
                  )}
                </>
              )}

              <div className={styles.actions}>
                <span className={styles.actionNote}>
                  {sourceEnvs.length === 0
                    ? `${sourceProject} has no other environment to copy from.`
                    : preview
                      ? 'The source is read again on apply, so live edits may shift these numbers slightly.'
                      : 'Preview reads both environments and writes nothing.'}
                </span>
                <div className={styles.actionButtons}>
                  {preview && (
                    <Button variant="secondary" onClick={invalidate} disabled={busy}>
                      Cancel
                    </Button>
                  )}
                  <Button
                    variant="primary"
                    onClick={() => run(preview === null)}
                    disabled={busy || !from || !allowed || applied !== null}
                  >
                    {busy ? <RefreshCw size={14} className="spin" /> : preview ? <Check size={14} /> : <Copy size={14} />}
                    {busy ? 'Working…' : preview ? 'Apply copy' : applied ? 'Copy complete' : 'Preview copy'}
                  </Button>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </>
  )
}
