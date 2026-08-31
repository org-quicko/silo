import { AlertTriangle, Check, Link2 } from 'lucide-react'
import { Button } from '../../../components/buttons/Button'
import { Segmented } from '../../../components/controls/Segmented'
import type { Server } from '../../servers/server'
import settings from '../SettingsView.module.css'
import { MediaExtensionField } from './MediaExtensionField'
import { MediaPolicyNote } from './MediaPolicyNote'
import { useMediaPolicyForm } from './use-media-policy-form'
import styles from './MediaStoragePage.module.css'

/**
 * Where media URLs point, and what the library accepts (D46).
 *
 * The second card of the Media Library page, with its own Save because it
 * writes its own table through its own route. The storage card above it can be
 * failing to open a bucket while this one saves perfectly well, and neither
 * should hold the other up.
 */
export function MediaLibraryCard({ server, canConfigure }: { server: Server; canConfigure: boolean }) {
  const form = useMediaPolicyForm(server.url, server.apiKey, canConfigure)
  const { view, draft } = form
  const editable = !!view?.writable && !form.saving
  if (!view) return null

  return (
    <section className={settings.card}>
      <div className={settings.cardHeader}>
        <div className={settings.sectionTitle}>
          <Link2 size={16} />
          <h2>Library</h2>
        </div>
        <p>The address media is served from, and the file types this library takes.</p>
      </div>

      <form onSubmit={form.save} className={settings.form}>
        <div className={settings.inputGroup}>
          <div className={styles.fieldHead}>
            <label htmlFor="media-base-url">Base URL</label>
            <MediaPolicyNote view={view} field="base_url" />
          </div>
          <input
            id="media-base-url"
            type="text"
            value={draft.base_url}
            disabled={!editable}
            placeholder={server.url}
            onChange={(event) => form.set('base_url', event.target.value)}
          />
          <span className={styles.help}>
            Leave empty to use the address each request arrives on.
          </span>
        </div>

        <div className={settings.inputGroup}>
          <div className={styles.fieldHead}>
            <label>What it points at</label>
            <MediaPolicyNote view={view} field="base_url_target" />
          </div>
          <Segmented
            value={draft.base_url_target}
            disabled={!editable}
            options={[
              { value: 'server', label: 'This server' },
              { value: 'store', label: 'The bucket' },
            ]}
            onChange={(value) => form.set('base_url_target', value)}
          />
          <span className={styles.help}>
            {draft.base_url_target === 'server'
              ? 'Files are streamed by silo. The bucket stays private.'
              : 'Files are served by the bucket or a CDN. It must be publicly readable.'}
          </span>
        </div>

        <div className={settings.inputGroup}>
          <div className={styles.fieldHead}>
            <label>Permitted file types</label>
            <MediaPolicyNote view={view} field="extensions" />
          </div>
          <MediaExtensionField
            value={draft.extensions}
            disabled={!editable}
            defaults={view.default_extensions}
            onChange={(next) => form.set('extensions', next)}
          />
        </div>

        {form.error && (
          <div className={settings.alertError}>
            <AlertTriangle size={15} />
            <span>{form.error}</span>
          </div>
        )}

        {form.saved && (
          <div className={settings.alertSuccess}>
            <Check size={15} />
            <span>Saved. Files already in the library are unchanged.</span>
          </div>
        )}

        <div className={settings.formActions}>
          <Button type="submit" variant="primary" disabled={!editable || !form.dirty}>
            <Check size={14} />
            <span>{form.saving ? 'Saving…' : 'Save Changes'}</span>
          </Button>
        </div>
      </form>
    </section>
  )
}
