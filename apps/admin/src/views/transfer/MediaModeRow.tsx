import type { MediaMode } from '../../api/types/media-mode'
import { SettingsRow } from '../settings/parts/SettingsRow'
import ledger from '../settings/parts/SettingsLedger.module.css'

const HELP: Record<MediaMode, string> = {
  all: 'Every file in the library.',
  referenced: 'Only the files the transferred entries point at.',
  none: 'Filenames and folders travel, the bytes stay put.',
}

/** What a transfer does about media files. One line each; the reasoning is in
 *  docs/guide/transfer.md. */
export function MediaModeRow({
  value,
  onChange,
  disabled,
  label = 'Media files',
}: {
  value: MediaMode
  onChange: (next: MediaMode) => void
  disabled?: boolean
  label?: string
}) {
  return (
    <SettingsRow label={label} help={HELP[value]}>
      <select
        className={ledger.select}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as MediaMode)}
        aria-label={label}
      >
        <option value="all">Include all files</option>
        <option value="referenced">Only referenced files</option>
        <option value="none">No files</option>
      </select>
    </SettingsRow>
  )
}
