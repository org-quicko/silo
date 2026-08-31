import { Activity } from 'lucide-react'
import type { MediaStorageView } from '../../../api/types/media-storage'
import settings from '../SettingsView.module.css'

/**
 * What this server is using right now, as opposed to what the form holds.
 *
 * Deliberately a read-only panel next to an editable one, the way Connection
 * puts live diagnostics beside the endpoint you can change: the form is a
 * proposal until it is saved, and on an instance configured through the
 * environment it may never be the whole answer.
 */
export function MediaStorageInForce({ view }: { view: MediaStorageView }) {
  const facts = view.in_force
  const location = facts.driver === 'fs' ? facts.path : facts.bucket

  return (
    <section className={settings.card}>
      <div className={settings.cardHeader}>
        <div className={settings.sectionTitle}>
          <Activity size={16} />
          <h2>In Use Now</h2>
        </div>
        <p>What this server is writing uploads to, after config file, environment and flags.</p>
      </div>

      <div className={settings.diagnosticsGrid}>
        <div className={settings.diagCard}>
          <span className={settings.diagLabel}>Provider</span>
          <span className={settings.diagValue}>{facts.driver}</span>
        </div>
        <div className={settings.diagCard}>
          <span className={settings.diagLabel}>
            {facts.driver === 'fs' ? 'Directory' : 'Bucket'}
          </span>
          <span className={settings.diagMono}>{location || '—'}</span>
        </div>
        <div className={settings.diagCard}>
          <span className={settings.diagLabel}>Credentials</span>
          <span className={settings.diagValue}>
            {facts.access_key_id
              ? `${facts.access_key_id}${facts.secret_access_key_set ? '' : ' (no secret)'}`
              : facts.secret_access_key_set
                ? 'secret only'
                : 'none'}
          </span>
        </div>
      </div>

      <div className={settings.diagnosticsGrid}>
        <div className={settings.diagCard}>
          <span className={settings.diagLabel}>Endpoint</span>
          <span className={settings.diagMono}>{facts.endpoint || 'provider default'}</span>
        </div>
        <div className={settings.diagCard}>
          <span className={settings.diagLabel}>Addressing</span>
          <span className={settings.diagValue}>
            {facts.force_path_style ? 'path style' : 'virtual hosted'}
          </span>
        </div>
        <div className={settings.diagCard}>
          <span className={settings.diagLabel}>Config file</span>
          <span className={settings.diagMono}>{view.config_path || 'none'}</span>
        </div>
      </div>
    </section>
  )
}
