import { AlertTriangle } from 'lucide-react'
import { Button } from '../../../components/buttons/Button'
import { Segmented } from '../../../components/controls/Segmented'
import type { Server } from '../../servers/server'
import { SettingsRow } from '../parts/SettingsRow'
import { SettingsSection } from '../parts/SettingsSection'
import ledger from '../parts/SettingsLedger.module.css'
import settings from '../SettingsView.module.css'
import { MediaExtensionField } from './MediaExtensionField'
import { MediaPolicyNote } from './MediaPolicyNote'
import { useMediaPolicyForm } from './use-media-policy-form'

/**
 * Where media URLs point, and what the library accepts (D46).
 *
 * The second section of the Media Library page, with its own Save because it
 * writes its own table through its own route. The storage section above it can
 * be failing to open a bucket while this one saves perfectly well, and neither
 * should hold the other up.
 */
export function MediaLibraryCard({
  server,
  canConfigure,
}: {
  server: Server
  canConfigure: boolean
}) {
  const form = useMediaPolicyForm(server.url, server.apiKey, canConfigure)
  const { view, draft } = form
  const editable = !!view?.writable && !form.saving
  if (!view) return null

  return (
    <form onSubmit={form.save}>
      <SettingsSection title="Advanced">
        <SettingsRow
          label="Base URL"
          htmlFor="media-base-url"
          help="Leave empty to use the address each request arrives on."
        >
          <input
            id="media-base-url"
            className={`${ledger.field} ${ledger.fieldMono}`}
            type="text"
            value={draft.base_url}
            disabled={!editable}
            placeholder={server.url}
            onChange={(event) => form.set('base_url', event.target.value)}
          />
          <MediaPolicyNote view={view} field="base_url" />
        </SettingsRow>

        <SettingsRow
          label="What it points at"
          help={
            draft.base_url_target === 'server'
              ? 'Files are streamed by silo. The bucket stays private.'
              : 'Files are served by the bucket or a CDN. It must be publicly readable.'
          }
        >
          <Segmented
            value={draft.base_url_target}
            disabled={!editable}
            options={[
              { value: 'server', label: 'This server' },
              { value: 'store', label: 'The bucket' },
            ]}
            onChange={(value) => form.set('base_url_target', value)}
          />
          <MediaPolicyNote view={view} field="base_url_target" />
        </SettingsRow>

        <SettingsRow label="Permitted file types" stack>
          <MediaExtensionField
            value={draft.extensions}
            disabled={!editable}
            defaults={view.default_extensions}
            onChange={(next) => form.set('extensions', next)}
          />
          <MediaPolicyNote view={view} field="extensions" />
        </SettingsRow>

        {form.error && (
          <div className={settings.alertError}>
            <AlertTriangle size={15} />
            <span>{form.error}</span>
          </div>
        )}

        <div className={ledger.sectionActions}>
          {form.saved && (
            <span className={`${ledger.sectionNote} ${ledger.noteOk}`}>
              Saved. Files already in the library are unchanged.
            </span>
          )}
          <Button type="submit" variant="primary" disabled={!editable || !form.dirty}>
            {form.saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </SettingsSection>
    </form>
  )
}
