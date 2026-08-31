import type { MediaStorageView } from '../../../api/types/media-storage'
import { Toggle } from '../../../components/controls/Toggle'
import passwordStyles from '../../../components/controls/PasswordInput.module.css'
import settings from '../SettingsView.module.css'
import { MediaStorageDraft, type MediaStorageFields } from './media-storage-draft'
import { MediaStorageNote } from './MediaStorageNote'
import styles from './MediaStoragePage.module.css'

/**
 * What a bucket-backed provider takes: where the bucket is, and what reaches it.
 *
 * Split off the page rather than inlined, because it is most of the form and it
 * is conditional. `MediaStorageDraft.shows` decides when it appears, and an
 * unknown driver gets it too: every driver is handed the same `[blob_storage]`
 * table and nothing here can know which keys a provider plugin reads.
 */
export function MediaStorageBucketFields({
  view,
  draft,
  editable,
  secret,
  clearSecret,
  onChange,
  onSecret,
  onClearSecret,
}: {
  view: MediaStorageView
  draft: MediaStorageFields
  editable: boolean
  secret: string
  clearSecret: boolean
  onChange: <K extends keyof MediaStorageFields>(field: K, value: MediaStorageFields[K]) => void
  onSecret: (value: string) => void
  onClearSecret: (value: boolean) => void
}) {
  return (
    <>
      <div className={settings.inputGrid}>
        <div className={settings.inputGroup}>
          <div className={styles.fieldHead}>
            <label htmlFor="media-bucket">Bucket</label>
            <MediaStorageNote view={view} field="bucket" />
          </div>
          <input
            id="media-bucket"
            type="text"
            value={draft.bucket}
            disabled={!editable}
            placeholder="silo-media"
            onChange={(event) => onChange('bucket', event.target.value)}
          />
        </div>

        <div className={settings.inputGroup}>
          <div className={styles.fieldHead}>
            <label htmlFor="media-region">Region</label>
            <MediaStorageNote view={view} field="region" />
          </div>
          <input
            id="media-region"
            type="text"
            value={draft.region}
            disabled={!editable}
            placeholder="us-east-1"
            onChange={(event) => onChange('region', event.target.value)}
          />
        </div>
      </div>

      <div className={settings.inputGroup}>
        <div className={styles.fieldHead}>
          <label htmlFor="media-endpoint">Endpoint</label>
          <MediaStorageNote view={view} field="endpoint" />
        </div>
        {/*
          Deliberately not an AWS endpoint. This box exists for the providers
          that need one, and an `s3.<region>.amazonaws.com` example sitting
          above "leave empty for AWS" reads as an instruction to fill it in.
        */}
        <input
          id="media-endpoint"
          type="text"
          value={draft.endpoint}
          disabled={!editable}
          placeholder="https://minio.example.com:9000"
          onChange={(event) => onChange('endpoint', event.target.value)}
        />
        <span className={styles.help}>
          Only for S3 compatible providers. Leave empty for AWS.
        </span>
      </div>

      <div className={settings.inputGrid}>
        <div className={settings.inputGroup}>
          <div className={styles.fieldHead}>
            <label htmlFor="media-access-key">Access key ID</label>
            <MediaStorageNote view={view} field="access_key_id" />
          </div>
          <input
            id="media-access-key"
            type="text"
            value={draft.access_key_id}
            disabled={!editable}
            placeholder="AKIA…"
            onChange={(event) => onChange('access_key_id', event.target.value)}
          />
        </div>

        {/*
          Write-only: the read never returns it, so a stored secret shows as a
          mask its box will not let you edit, and clearing it is what opens the
          box for a new one. Two reasons for the detour. An editable box holding
          a mask invites somebody to append to a value they cannot see, and an
          empty one that quietly kept the old secret reads as "not set" to
          everybody who did not write this page.
        */}
        <div className={settings.inputGroup}>
          <div className={styles.fieldHead}>
            <label htmlFor="media-secret">Secret access key</label>
            {view.file.secret_access_key_set && (
              <button
                type="button"
                className={styles.inlineAction}
                disabled={!editable}
                onClick={() => onClearSecret(!clearSecret)}
              >
                {clearSecret ? 'Keep it' : 'Clear it'}
              </button>
            )}
          </div>
          <div className={passwordStyles.wrapper}>
            {view.file.secret_access_key_set && !clearSecret ? (
              <input
                id="media-secret"
                type="text"
                className={styles.masked}
                value={MediaStorageDraft.SecretMask}
                readOnly
                disabled
              />
            ) : (
              <input
                id="media-secret"
                type="password"
                value={secret}
                disabled={!editable}
                placeholder={view.file.secret_access_key_set ? 'Enter a new key' : 'Not set'}
                onChange={(event) => onSecret(event.target.value)}
              />
            )}
          </div>
          <span className={clearSecret ? styles.note : styles.help}>
            {clearSecret
              ? 'Type a new key, or save with this empty to remove it.'
              : view.file.secret_access_key_set
                ? 'Stored in the config file. Clear it to enter a new one.'
                : 'Stored in the config file. Prefer SILO_BLOB_S3_SECRET_ACCESS_KEY.'}
          </span>
          <MediaStorageNote view={view} field="secret_access_key" />
        </div>
      </div>

      <div className={styles.toggleRow}>
        <Toggle
          on={draft.force_path_style}
          disabled={!editable}
          onChange={(value) => onChange('force_path_style', value)}
        />
        <span className={styles.toggleCopy}>
          <b>Path style addressing</b>
          <span className={styles.help}>Required by MinIO and most self hosted gateways.</span>
        </span>
        <MediaStorageNote view={view} field="force_path_style" />
      </div>
    </>
  )
}
