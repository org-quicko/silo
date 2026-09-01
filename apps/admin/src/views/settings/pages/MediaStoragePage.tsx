import { AlertTriangle, Check, HardDrive, RefreshCw } from 'lucide-react'
import { Claims } from '@silo/shared/claims'
import { Button } from '../../../components/buttons/Button'
import { Breadcrumb } from '../../../components/navigation/Breadcrumb'
import { TopBar } from '../../shell/TopBar'
import type { Server } from '../../servers/server'
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
        <div className="page-head">
          <div className="page-title-group">
            <h2 className="page-title">Media Library</h2>
            <span className="page-sub">
              Choose where uploaded files are stored, and configure the provider that keeps them.
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
            This key cannot read or change media storage. It needs the{' '}
            <code>{Claims.MediaConfigure}</code> claim.
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
            <section className={settings.card}>
              <div className={settings.cardHeader}>
                <div className={settings.sectionTitle}>
                  <HardDrive size={16} />
                  <h2>Storage Provider</h2>
                </div>
                <p>
                  Saved to {view.config_path || 'the config file'} and applied to this server
                  immediately.
                </p>
              </div>

              <form onSubmit={form.save} className={settings.form}>
                <div className={settings.inputGrid}>
                  <div className={settings.inputGroup}>
                    <div className={styles.fieldHead}>
                      <label htmlFor="media-driver">Provider</label>
                      <MediaStorageNote view={view} field="driver" />
                    </div>
                    <select
                      id="media-driver"
                      className={styles.select}
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
                    <span className={styles.help}>
                      Existing files are not moved. Switching provider leaves them where they are.
                    </span>
                  </div>

                  {shows.directory && (
                    <div className={settings.inputGroup}>
                      <div className={styles.fieldHead}>
                        <label htmlFor="media-path">Directory</label>
                        <MediaStorageNote view={view} field="path" />
                      </div>
                      <input
                        id="media-path"
                        type="text"
                        value={draft.path}
                        disabled={!editable}
                        placeholder={view.in_force.path || './silo_data/media'}
                        onChange={(event) => form.set('path', event.target.value)}
                      />
                      <span className={styles.help}>
                        Leave empty to follow the data directory.
                      </span>
                    </div>
                  )}
                </div>

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

                {!view.writable && (
                  <div className={styles.notice}>
                    <AlertTriangle size={14} />
                    <span>
                      {view.read_only_reason ??
                        'This server cannot write its config file, so this form is read-only.'}
                    </span>
                  </div>
                )}

                {form.saved && (
                  <div className={settings.alertSuccess}>
                    <Check size={15} />
                    <span>Saved. New uploads go to the provider above.</span>
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

            <MediaLibraryCard server={server} canConfigure={canConfigure} />

            <MediaStorageInForce view={view} />
          </div>
        )}
      </div>
    </>
  )
}
