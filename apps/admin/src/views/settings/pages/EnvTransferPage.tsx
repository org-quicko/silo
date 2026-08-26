import { AlertTriangle, ArrowRight, Check, Copy, RefreshCw } from 'lucide-react'
import { Claims } from '@silo/shared/claims'
import { Button } from '../../../components/buttons/Button'
import { Breadcrumb } from '../../../components/navigation/Breadcrumb'
import { StatRow } from '../../../components/data/StatRow'
import { StatTile } from '../../../components/data/StatTile'
import { Routes } from '../../../router/routes'
import type { ScopeRef } from '../../../api/types/scope-ref'
import { useScopeCopy } from './use-scope-copy'
import { TopBar } from '../../shell/TopBar'
import type { Server } from '../../servers/server'
import settings from '../SettingsView.module.css'
import styles from './EnvTransferPage.module.css'

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
}: {
  server: Server
  /** The destination — the environment whose settings these are. */
  scope: ScopeRef
  projects: string[]
  claims: string[]
}) {
  const copy = useScopeCopy(server, scope, claims)


  return (
    <>
      <TopBar />

      <div className="content">
        <Breadcrumb
          crumbs={[
            { label: scope.project, to: Routes.projectSettings(server.id, scope.project, 'general') },
            { label: scope.env, to: Routes.envSettings(server.id, scope.project, scope.env, 'general') },
            { label: 'Data Transfer' },
          ]}
        />
        <div className="page-head">
          <div className="page-title-group">
            <h2 className="page-title">Data Transfer</h2>
            <span className="page-sub">
              Copy collections, schemas and entries from another environment into{' '}
              <b>{scope.project}/{scope.env}</b>. Preview first — nothing is written until you apply.
            </span>
          </div>
        </div>

        {copy.error && (
          <div className={settings.alertError}>
            <AlertTriangle size={15} />
            <span>{copy.error}</span>
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
                    value={copy.sourceProject}
                    onChange={(event) => copy.setSourceProject(event.target.value)}
                    disabled={copy.busy}
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
                    value={copy.sourceEnv}
                    onChange={(event) => copy.setSourceEnv(event.target.value)}
                    disabled={copy.busy || copy.sourceEnvironments.length === 0}
                  >
                    {copy.sourceEnvironments.length === 0 && <option value="">No other environment</option>}
                    {copy.sourceEnvironments.map((env) => (
                      <option key={env} value={env}>
                        {env}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="field">
                  <label className="field-label" htmlFor="copy-copy.mode">
                    Mode
                  </label>
                  <select
                    id="copy-copy.mode"
                    className="input"
                    value={copy.mode}
                    onChange={(e) => {
                      copy.setMode(e.target.value as Mode)
                    }}
                    disabled={copy.busy}
                  >
                    <option value="merge">Merge</option>
                    <option value="replace">Replace source collections</option>
                  </select>
                </div>

                {copy.mode === 'merge' && (
                  <div className="field">
                    <label className="field-label" htmlFor="copy-copy.prefer">
                      On conflicts
                    </label>
                    <select
                      id="copy-copy.prefer"
                      className="input"
                      value={copy.prefer}
                      onChange={(e) => {
                        copy.setPrefer(e.target.value as Prefer)
                      }}
                      disabled={copy.busy}
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
                  {copy.from ? `${copy.from.project}/${copy.from.env}` : '—'}
                </span>
                <ArrowRight size={15} className={styles.arrow} />
                <span className={styles.scopeTo}>
                  {scope.project}/{scope.env}
                </span>
              </div>

              {copy.mode === 'replace' && (
                <div className="banner banner-warn">
                  <AlertTriangle size={15} />
                  <span>
                    Every collection the source carries is emptied in {scope.env} before it is written.
                    Collections that exist only here are left alone.
                  </span>
                </div>
              )}

              {copy.from && !copy.canRead && (
                <div className="banner banner-bad">
                  <AlertTriangle size={15} />
                  <span>
                    This key cannot read all of {copy.from.project}/{copy.from.env} — it is missing{' '}
                    <code>{Claims.collection(copy.from.project, copy.from.env, '*', Claims.CollectionEntriesRead)}</code>.
                  </span>
                </div>
              )}

              {!copy.canWrite && (
                <div className="banner banner-bad">
                  <AlertTriangle size={15} />
                  <span>
                    This key cannot write all of {scope.project}/{scope.env} — it is missing{' '}
                    <code>{Claims.collection(scope.project, scope.env, '*', Claims.CollectionEntriesCreate)}</code>.
                  </span>
                </div>
              )}

              {copy.mode === 'replace' && copy.canWrite && !copy.canReplace && (
                <div className="banner banner-bad">
                  <AlertTriangle size={15} />
                  <span>
                    Replace mode additionally needs{' '}
                    <code>{Claims.collection(scope.project, scope.env, '*', Claims.CollectionEntriesDelete)}</code>.
                  </span>
                </div>
              )}

              {copy.busy && (
                <div className={styles.progress}>
                  <RefreshCw size={14} className="spin" />
                  {copy.preview ? 'Copying…' : 'Comparing the two environments…'}
                </div>
              )}

              {copy.result && (
                <>
                  <StatRow>
                    <StatTile n={copy.result.added} label="to create" tone="ok" prefix="+" />
                    <StatTile n={copy.result.updated} label="to update" tone="warn" prefix="~" />
                    <StatTile n={copy.result.deleted} label="to delete" tone="bad" />
                    <StatTile n={copy.result.skipped} label="unchanged" tone="muted" />
                  </StatRow>
                  {copy.applied && (
                    <div className="banner banner-ok">
                      <Check size={15} />
                      <span>
                        Copied into {scope.env} in <b>{copy.applied.mode}</b> mode.
                      </span>
                    </div>
                  )}
                </>
              )}

              <div className={styles.actions}>
                <span className={styles.actionNote}>
                  {copy.sourceEnvironments.length === 0
                    ? `${copy.sourceProject} has no other environment to copy from.`
                    : copy.preview
                      ? 'The source is read again on apply, so live edits may shift these numbers slightly.'
                      : 'Preview reads both environments and writes nothing.'}
                </span>
                <div className={styles.actionButtons}>
                  {copy.preview && (
                    <Button variant="secondary" onClick={() => copy.setMode(copy.mode)} disabled={copy.busy}>
                      Cancel
                    </Button>
                  )}
                  <Button
                    variant="primary"
                    onClick={() => copy.run(copy.preview === null)}
                    disabled={copy.busy || !copy.from || !copy.allowed || copy.applied !== null}
                  >
                    {copy.busy ? <RefreshCw size={14} className="spin" /> : copy.preview ? <Check size={14} /> : <Copy size={14} />}
                    {copy.busy ? 'Working…' : copy.preview ? 'Apply copy' : copy.applied ? 'Copy complete' : 'Preview copy'}
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
