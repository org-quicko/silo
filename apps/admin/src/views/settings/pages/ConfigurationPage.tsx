import { AlertTriangle, RefreshCw, RotateCw } from 'lucide-react'
import { Claims } from '@silo/shared/claims'
import { Button } from '../../../components/buttons/Button'
import { Breadcrumb } from '../../../components/navigation/Breadcrumb'
import { TopBar } from '../../shell/TopBar'
import type { Server } from '../../servers/server'
import settings from '../SettingsView.module.css'
import { ConfigSectionCard } from './ConfigSectionCard'
import { useConfigSettingsForm } from './use-config-settings-form'
import styles from './MediaStoragePage.module.css'

/**
 * The rest of `silo.toml`, edited from the admin (D47).
 *
 * Logging, search, schema validation and the auth switch were reachable only by
 * editing a file next to the process, which is fine on a box with a shell and
 * impossible on a managed platform without one. Like the media pages, this one
 * writes that same file rather than keeping a second copy of the answer.
 *
 * Its difference from those pages is worth stating plainly, because it is the
 * thing an operator has to trust: **not everything here applies immediately.**
 * A log level is a threshold read on every line, so it takes effect at once; a
 * tokenizer rebuilds an index at boot and a log file is a handle opened once.
 * Every field says which it is, and a saved value still waiting for a restart is
 * reported as waiting rather than as in force.
 */
export function ConfigurationPage({ server, claims }: { server: Server; claims: string[] }) {
  // The shell resolves the session over its own round trip, so an empty claim
  // list means "not known yet" rather than "holds nothing".
  const sessionKnown = claims.length > 0
  const canConfigure = Claims.has(claims, Claims.SettingsConfigure)
  const form = useConfigSettingsForm(server.url, server.apiKey, canConfigure)
  const { view } = form
  const loading = !sessionKnown || (canConfigure && form.loading)

  return (
    <>
      <TopBar />

      <div className="content">
        <Breadcrumb crumbs={[{ label: server.name }, { label: 'Configuration' }]} />
        <div className="page-head">
          <div className="page-title-group">
            <h2 className="page-title">Configuration</h2>
            <span className="page-sub">
              {view?.config_path
                ? `The rest of ${view.config_path}.`
                : "The server's own settings."}
            </span>
          </div>
          {canConfigure && (
            <Button variant="secondary" onClick={form.reload} disabled={loading}>
              <RefreshCw size={14} />
              <span>Reload</span>
            </Button>
          )}
        </div>

        {!loading && !canConfigure && (
          <div className={styles.readOnly}>
            This key cannot read or change the server settings. It needs the{' '}
            <code>{Claims.SettingsConfigure}</code> claim.
          </div>
        )}

        {form.error && (
          <div className={settings.alertError}>
            <AlertTriangle size={15} />
            <span>{form.error}</span>
          </div>
        )}

        {loading && <div className={styles.readOnly}>Loading…</div>}

        {view && (
          <div className={settings.generalContent}>
            {!view.writable && (
              <div className={styles.notice}>
                <AlertTriangle size={14} />
                <span>
                  This server was started without a config file, so there is nothing to write to.
                  Start it with <code>--config</code>, or set the matching{' '}
                  <code>SILO_*</code> variables.
                </span>
              </div>
            )}

            {view.restart_pending && (
              <div className={styles.notice}>
                <RotateCw size={14} />
                <span>
                  Some saved settings take effect the next time this server starts.
                </span>
              </div>
            )}

            {view.sections.map((section) => (
              <ConfigSectionCard key={section.table} section={section} onSave={form.saveSection} />
            ))}
          </div>
        )}
      </div>
    </>
  )
}
