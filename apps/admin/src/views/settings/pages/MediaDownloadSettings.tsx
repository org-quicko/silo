import type { MediaDownloadField, MediaPolicyView } from '../../../api/types/media-settings'
import { SettingsRow } from '../parts/SettingsRow'
import ledger from '../parts/SettingsLedger.module.css'
import type { MediaPolicyFields } from './media-policy-draft'
import { MediaPolicyNote } from './MediaPolicyNote'

const Rows: { field: MediaDownloadField; label: string; help: string }[] = [
  { field: 'download_max_files', label: 'Files per download', help: 'The most files one bulk download can hold.' },
  { field: 'download_max_size_mb', label: 'Size per download', help: 'Megabytes. Sent as zip files of up to 2 GB.' },
  { field: 'download_max_streams', label: 'Downloads at once', help: 'Zip files the server sends at the same time.' },
]

/** The bulk download ceilings (D106). An empty box is the default, shown as its placeholder. */
export function MediaDownloadSettings({
  view,
  draft,
  disabled,
  onChange,
}: {
  view: MediaPolicyView
  draft: MediaPolicyFields
  disabled: boolean
  onChange: (field: MediaDownloadField, value: string) => void
}) {
  return (
    <>
      {Rows.map(({ field, label, help }) => {
        const { value, min, max } = view.download_defaults[field]
        return (
          <SettingsRow key={field} label={label} htmlFor={`media-${field}`} help={help}>
            <input
              id={`media-${field}`}
              className={ledger.field}
              type="number"
              inputMode="numeric"
              min={min}
              max={max}
              step={1}
              value={draft[field]}
              disabled={disabled}
              placeholder={String(value)}
              onChange={(event) => onChange(field, event.target.value)}
            />
            <MediaPolicyNote view={view} field={field} />
          </SettingsRow>
        )
      })}
    </>
  )
}
