import { AlertTriangle } from 'lucide-react'
import { Button } from '../../../components/buttons/Button'
import type { Server } from '../../servers/server'
import { SettingsRow } from '../parts/SettingsRow'
import { SettingsSection } from '../parts/SettingsSection'
import ledger from '../parts/SettingsLedger.module.css'
import settings from '../SettingsView.module.css'
import { MediaExtensionField } from './MediaExtensionField'
import { MediaPolicyNote } from './MediaPolicyNote'
import { useMediaPolicyForm } from './use-media-policy-form'

/**
 * Where media URLs point, and what the library accepts (D46, D58).
 *
 * The second section of the Media Library page, with its own Save because it
 * writes its own table through its own route. The storage section above it can
 * be failing to open a bucket while this one saves perfectly well, and neither
 * should hold the other up.
 *
 * There is no control here for *what* the base URL stands in front of. The
 * provider above already decided that: a bucket serves its own objects and a
 * base is a CDN over them, and where silo serves the bytes a base is a name in
 * front of silo. D58 removed the setting because it could disagree with the
 * provider, and did.
 */
export function MediaLibraryCard({
  server,
  bucketBacked,
  canConfigure,
}: {
  server: Server
  /** Whether the provider in force serves its own objects, which is what
   *  decides the sentence under the base URL box. */
  bucketBacked: boolean
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
          help={
            bucketBacked
              ? 'The host in front of the bucket. Leave empty to link to the bucket itself.'
              : 'Leave empty to use the address each request arrives on.'
          }
        >
          <input
            id="media-base-url"
            className={`${ledger.field} ${ledger.fieldMono}`}
            type="text"
            value={draft.base_url}
            disabled={!editable}
            placeholder={bucketBacked ? 'https://cdn.example.com' : server.url}
            onChange={(event) => form.set('base_url', event.target.value)}
          />
          <MediaPolicyNote view={view} field="base_url" />
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
