import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Claims } from '@silo/shared/claims'
import { Button } from '../../../components/buttons/Button'
import { Breadcrumb } from '../../../components/navigation/Breadcrumb'
import { TopBar } from '../../shell/TopBar'
import type { Server } from '../../servers/server'
import { SettingsAlert } from '../parts/SettingsAlert'
import { SettingsPageHead } from '../parts/SettingsPageHead'
import { SettingsRow } from '../parts/SettingsRow'
import { SettingsSection } from '../parts/SettingsSection'
import ledger from '../parts/SettingsLedger.module.css'
import settings from '../SettingsView.module.css'
import { MediaStorageBucketFields } from './MediaStorageBucketFields'
import { MediaLibraryCard } from './MediaLibraryCard'
import { MediaStorageDraft } from './media-storage-draft'
import { MediaStorageInForce } from './MediaStorageInForce'
import { MediaStorageNote } from './MediaStorageNote'
import { useMediaStorageForm } from './use-media-storage-form'
import styles from './MediaStoragePage.module.css'

/**
 * Where the media library keeps its bytes (D45).
 *
 * The settings were reachable only through `silo.toml`, the `SILO_BLOB_*`
 * environment variables or a flag, which meant an operator on a managed
 * platform could not point silo at a bucket at all. This page writes the same
 * file and applies the result to the running server, so nothing here is a
 * second source of truth.
 *
 * It shows two configurations on purpose. The form is what the file holds, and
 * "In Use Now" is what the server is doing, because an environment variable
 * outranks the file and a page that hid that would let somebody save a bucket
 * the instance then ignores.
 *
 * Two cards, two Saves, two tables (D46): `[blob_storage]` decides where the
 * bytes go, `[media]` decides where their URLs point and what may be uploaded.
 * They are not one form because a bucket that will not open must not be able
 * to hold up a correction to the allowlist.
 */
export function MediaStoragePage({ server, claims }: { server: Server; claims: string[] }) {
  // The shell resolves the session over its own round trip, so an empty claim
  // list means "not known yet" rather than "holds nothing" — telling somebody
  // they lack a claim on the way to discovering they have it is the one thing
  // this gate must not do.
  const sessionKnown = claims.length > 0
  const canConfigure = Claims.has(claims, Claims.MediaConfigure)
  const form = useMediaStorageForm(server.url, server.apiKey, canConfigure)
  const { view, draft } = form
  const shows = MediaStorageDraft.shows(draft.driver)
  const editable = !!view?.writable && !form.saving
  const loading = !sessionKnown || (canConfigure && form.loading)

  return (
    <>
      <TopBar />

      <div className="content">
        <Breadcrumb crumbs={[{ label: server.name }, { label: 'Media Library' }]} />

        <SettingsPageHead
          title="Media Library"
          actions={
            canConfigure && (
              <Button variant="secondary" onClick={form.reload} disabled={loading}>
                <RefreshCw size={14} />
                <span>Reload</span>
              </Button>
            )
          }
        />

        {!loading && !canConfigure && (
          <SettingsAlert tone="bad" title="Not readable with this key">
            Reading or changing media storage needs the <code>{Claims.MediaConfigure}</code> claim.
          </SettingsAlert>
        )}

        {form.error && (
          <div className={settings.alertError}>
            <AlertTriangle size={15} />
            <span>{form.error}</span>
          </div>
        )}

        {loading && <div className={styles.readOnly}>Loading…</div>}

        {view && (
          <>
            {!view.writable && (
              <SettingsAlert title="Read-only">
                {view.read_only_reason ??
                  'This server cannot write its config file, so these settings cannot be changed here.'}
              </SettingsAlert>
            )}

            <form onSubmit={form.save}>
              <SettingsSection title="Storage">
                <SettingsRow
                  label="Provider"
                  htmlFor="media-driver"
                  help="Existing files are not moved. Switching provider leaves them where they are."
                >
                  <select
                    id="media-driver"
                    className={ledger.select}
                    value={draft.driver}
                    disabled={!editable}
                    onChange={(event) => form.set('driver', event.target.value)}
                  >
                    {MediaStorageDraft.options(view).map((driver) => (
                      <option key={driver} value={driver}>
                        {driver}
                      </option>
                    ))}
                  </select>
                  <MediaStorageNote view={view} field="driver" />
                </SettingsRow>

                {shows.directory && (
                  <SettingsRow
                    label="Directory"
                    htmlFor="media-path"
                    help="Leave empty to follow the data directory."
                  >
                    <input
                      id="media-path"
                      className={`${ledger.field} ${ledger.fieldMono}`}
                      type="text"
                      value={draft.path}
                      disabled={!editable}
                      placeholder={view.in_force.path || './silo_data/media'}
                      onChange={(event) => form.set('path', event.target.value)}
                    />
                    <MediaStorageNote view={view} field="path" />
                  </SettingsRow>
                )}

                {shows.bucket && (
                  <MediaStorageBucketFields
                    view={view}
                    draft={draft}
                    editable={editable}
                    secret={form.secret}
                    clearSecret={form.clearSecret}
                    onChange={form.set}
                    onSecret={form.setSecret}
                    onClearSecret={form.setClearSecret}
                  />
                )}

                <div className={ledger.sectionActions}>
                  {form.saved && (
                    <span className={`${ledger.sectionNote} ${ledger.noteOk}`}>
                      Saved. New uploads go to the provider above.
                    </span>
                  )}
                  <Button type="submit" variant="primary" disabled={!editable || !form.dirty}>
                    {form.saving ? 'Saving…' : 'Save'}
                  </Button>
                </div>
              </SettingsSection>
            </form>

            <MediaLibraryCard server={server} canConfigure={canConfigure} />

            <MediaStorageInForce view={view} />
          </>
        )}
      </div>
    </>
  )
}
