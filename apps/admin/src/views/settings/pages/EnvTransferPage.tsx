import { AlertTriangle, ArrowRight, Copy } from 'lucide-react'
import { Claims } from '@silo/shared/claims'
import { Breadcrumb } from '../../../components/navigation/Breadcrumb'
import { Routes } from '../../../router/routes'
import type { ScopeRef } from '../../../api/types/scope-ref'
import { useScopeCopy } from './use-scope-copy'
import { useCopySource } from './use-copy-source'
import { useRemoteCopy } from './use-remote-copy'
import { TopBar } from '../../shell/TopBar'
import type { Server } from '../../servers/server'
import { SettingsPageHead } from '../parts/SettingsPageHead'
import settings from '../SettingsView.module.css'
import styles from './EnvTransferPage.module.css'
import { ScopeCopyPicker } from './ScopeCopyPicker'
import { ScopeCopyActions } from './ScopeCopyActions'
import { CopySourceFields } from './CopySourceFields'
import { RemoteTransferActions } from './RemoteTransferActions'
import { RemoteTransferPreview } from './RemoteTransferPreview'

type Mode = 'merge' | 'replace'
type Prefer = '' | 'local' | 'remote'

/**
 * Copy another environment's contents into this one.
 *
 * Scoped, unlike Server → Data Transfer: this moves one (project, env) onto
 * another inside the same instance and needs only the scoped claims a
 * read-then-write loop would (D22). The whole-instance archive lives under the
 * server, where its blast radius is stated.
 *
 * The source can also be another saved server (D112). Then the picker
 * reads that server with a key pasted for this copy, and Preview asks this
 * server to prepare a transfer: a saved plan that Apply writes exactly, or
 * not at all.
 */
export function EnvTransferPage({
  server,
  servers,
  scope,
  projects,
  claims,
}: {
  server: Server
  /** Every saved server; the others can be the source. */
  servers: Server[]
  /** The destination — the environment whose settings these are. */
  scope: ScopeRef
  projects: string[]
  claims: string[]
}) {
  const source = useCopySource(server, servers, projects)
  const copy = useScopeCopy(server, scope, claims, {
    endpoint: source.endpoint,
    remote: !!source.remote,
    claims: source.claims ?? claims,
    projects: source.projects,
  })
  const remote = useRemoteCopy(server, scope, claims, source, copy)
  const busy = copy.busy || remote.busy

  return (
    <>
      <TopBar />

      <div className="content">
        <Breadcrumb
          crumbs={[
            { label: server.name },
            { label: scope.project, to: Routes.projectSettings(server.id, scope.project, 'general') },
            { label: scope.env, to: Routes.envSettings(server.id, scope.project, scope.env, 'general') },
            { label: 'Data Transfer' },
          ]}
        />
        <SettingsPageHead
          title="Data Transfer"
          scope={{ kind: 'env', project: scope.project, env: scope.env }}
          sub="Preview first — nothing is written until you apply."
        />

        {(copy.error || remote.error) && (
          <div className={settings.alertError}>
            <AlertTriangle size={15} />
            <span>{source.remote ? remote.error || copy.error : copy.error}</span>
          </div>
        )}

        <div className={settings.generalContent}>
          <section className={styles.panel}>
            <div className={styles.header}>
              <span className={styles.heading}>
                <Copy size={15} /> Copy from another environment
              </span>
              {source.remote ? (
                <p>Fetches the selection from {source.remote.name} and writes it here as one change.</p>
              ) : (
                <p>
                  Runs entirely on the server — no archive is downloaded. Media is stored per instance rather
                  than per environment, so files in the media library are shared already and none are copied.
                </p>
              )}
            </div>

            <div className={styles.body}>
              <div className={styles.sourceGrid}>
                <CopySourceFields source={source} busy={busy} />

                <div className="field">
                  <label className="field-label" htmlFor="src-project">
                    Source project
                  </label>
                  <select
                    id="src-project"
                    className="input"
                    value={copy.sourceProject}
                    onChange={(event) => copy.setSourceProject(event.target.value)}
                    disabled={busy || source.projects.length === 0}
                  >
                    {source.projects.map((p) => (
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
                    disabled={busy || copy.sourceEnvironments.length === 0}
                  >
                    {copy.sourceEnvironments.length === 0 && (
                      <option value="">{source.remote ? 'No environment' : 'No other environment'}</option>
                    )}
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
                    disabled={busy}
                  >
                    <option value="merge">Merge</option>
                    <option value="replace" disabled={copy.customize && copy.selection.some((item) => item.entryIds !== undefined)}>Replace source collections</option>
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
                <span className={styles.directionLabel}>Source</span>
                <span className={styles.scopeFrom}>
                  {source.remote && `${source.remote.name} · `}
                  {copy.from ? `${copy.from.project}/${copy.from.env}` : '—'}
                </span>
                <ArrowRight size={15} className={styles.arrow} />
                <span className={styles.directionLabel}>Destination</span>
                <span className={styles.scopeTo}>
                  {scope.project}/{scope.env}
                </span>
              </div>

              <div className={styles.customize}>
                <label>
                  <input
                    type="checkbox"
                    checked={copy.customize}
                    onChange={(event) => copy.setCustomize(event.target.checked)}
                    disabled={busy}
                  />
                  Choose what to copy
                </label>
                <span>By default every collection and entry is copied. Selected collection schemas are copied too.</span>
              </div>

              {copy.customize && <ScopeCopyPicker copy={{ ...copy, busy }} />}

              {copy.mode === 'replace' && (
                <div className="banner banner-warn">
                  <AlertTriangle size={15} />
                  <span>
                    Every {copy.customize ? 'selected' : 'source'} collection is emptied in {scope.env} before it is written.
                    Collections that exist only here are left alone.
                  </span>
                </div>
              )}

              {copy.customize && copy.selection.some((item) => item.entryIds !== undefined) && (
                <div className="banner banner-warn"><AlertTriangle size={15} /><span>Individual entries use Merge so other destination entries are kept.</span></div>
              )}

              {copy.from && !copy.customize && !copy.canRead && (
                <div className="banner banner-bad">
                  <AlertTriangle size={15} />
                  <span>
                    {source.remote ? 'The source key' : 'This key'} cannot read all of {copy.from.project}/{copy.from.env} — it is missing{' '}
                    <code>{Claims.collection(copy.from.project, copy.from.env, '*', Claims.CollectionEntriesRead)}</code>.
                  </span>
                </div>
              )}

              {!copy.customize && !copy.canWrite && (
                <div className="banner banner-bad">
                  <AlertTriangle size={15} />
                  <span>
                    This key cannot write all of {scope.project}/{scope.env} — it is missing{' '}
                    <code>{Claims.collection(scope.project, scope.env, '*', Claims.CollectionEntriesCreate)}</code>.
                  </span>
                </div>
              )}

              {remote.missing.map((item) => (
                <div key={item.claim} className="banner banner-bad">
                  <AlertTriangle size={15} />
                  <span>
                    {item.holder} is missing <code>{item.claim}</code>.
                  </span>
                </div>
              ))}

              {!copy.customize && copy.mode === 'replace' && copy.canWrite && !copy.canReplace && (
                <div className="banner banner-bad">
                  <AlertTriangle size={15} />
                  <span>
                    Replace mode additionally needs{' '}
                    <code>{Claims.collection(scope.project, scope.env, '*', Claims.CollectionEntriesDelete)}</code>.
                  </span>
                </div>
              )}

              {source.remote ? (
                <>
                  <RemoteTransferPreview remote={remote} />
                  <RemoteTransferActions remote={remote} ready={remote.ready} source={source.remote.name} env={scope.env} />
                </>
              ) : (
                <ScopeCopyActions copy={copy} destination={scope} />
              )}
            </div>
          </section>
        </div>
      </div>
    </>
  )
}
