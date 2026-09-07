import { Check, RefreshCw } from 'lucide-react'
import { Button } from '../../components/buttons/Button'
import { Pill } from '../../components/feedback/Pill'
import { StatRow } from '../../components/data/StatRow'
import { StatTile } from '../../components/data/StatTile'
import { Segmented } from '../../components/controls/Segmented'
import { Toggle } from '../../components/controls/Toggle'
import type { ArchiveMode, ArchivePrefer, useArchiveTransfer } from './use-archive-transfer'
import { ArchiveDropzone } from './ArchiveDropzone'
import { SettingsAlert } from '../settings/parts/SettingsAlert'
import { SettingsRow } from '../settings/parts/SettingsRow'
import { SettingsSection } from '../settings/parts/SettingsSection'
import ledger from '../settings/parts/SettingsLedger.module.css'

/**
 * Upload an archive and see exactly what it would change before anything is
 * written.
 *
 * Choosing a file runs the dry run immediately rather than waiting for a
 * separate Preview button — every option below re-runs it, so what is on
 * screen always describes what Apply would actually do.
 */
export function ImportPanel({
  transfer,
  canReplaceAll,
}: {
  transfer: ReturnType<typeof useArchiveTransfer>
  canReplaceAll: boolean
}) {
  const result = transfer.applied || transfer.preview

  return (
    <>
      <SettingsSection title="Source" divider={false}>
        <ArchiveDropzone
          file={transfer.file}
          onPick={transfer.takeFile}
          onClear={transfer.reset}
          fileInput={transfer.fileInput}
          onInputChange={transfer.pickFile}
        />
      </SettingsSection>

      <SettingsSection title="How conflicts resolve">
        <SettingsRow
          label="Mode"
          help="Merge keeps collections the archive doesn't mention. Replace removes them."
        >
          <Segmented
            variant="fit"
            value={transfer.mode}
            onChange={(next) => transfer.changeMode(next as ArchiveMode)}
            options={[
              { value: 'merge', label: 'Merge' },
              { value: 'replace', label: canReplaceAll ? 'Replace' : 'Replace — needs instance-wide delete' },
            ]}
            disabled={!transfer.file}
          />
        </SettingsRow>

        {transfer.mode === 'merge' && (
          <SettingsRow label="When both sides changed an entry" help="Compared on updated_at.">
            <select
              className={ledger.select}
              value={transfer.prefer}
              disabled={!transfer.file}
              onChange={(event) => transfer.changePrefer(event.target.value as ArchivePrefer)}
            >
              <option value="">Newest wins</option>
              <option value="local">Keep local</option>
              <option value="remote">Use archive</option>
            </select>
          </SettingsRow>
        )}

        <SettingsRow
          label="Validate against schemas"
          help="Slower, but a malformed entry is refused at the door instead of landing in the collection."
          inline
        >
          <Toggle on={transfer.validate} disabled={!transfer.file} onChange={transfer.changeValidate} />
        </SettingsRow>

        {transfer.error && (
          <SettingsAlert tone="bad" title="Import failed">
            {transfer.error}
          </SettingsAlert>
        )}

        {transfer.busy && !result && (
          <div className={ledger.status}>
            <RefreshCw size={14} className="spin" /> Analyzing archive…
          </div>
        )}

        {result && (
          <StatRow>
            <StatTile n={result.added} label="to create" tone="ok" prefix="+" />
            <StatTile n={result.updated} label="to update" tone="warn" prefix="~" />
            <StatTile n={result.deleted} label="to delete" tone="bad" />
            <StatTile n={result.skipped} label="unchanged" tone="muted" />
          </StatRow>
        )}

        <div className={ledger.sectionActions}>
          {transfer.applied ? (
            <span className={`${ledger.sectionNote} ${ledger.noteOk}`}>
              <Check size={12} /> Applied in <b>{transfer.applied.mode}</b> mode.
            </span>
          ) : transfer.preview ? (
            <>
              <span className={ledger.sectionNote}>
                <Pill tone="warn" dot>
                  Preview — no changes written
                </Pill>
              </span>
              <Button variant="secondary" onClick={transfer.reset}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={transfer.apply}
                disabled={
                  transfer.busy ||
                  transfer.changeCount === 0 ||
                  (transfer.mode === 'replace' && !canReplaceAll)
                }
              >
                <Check size={14} /> Apply {transfer.changeCount} change
                {transfer.changeCount === 1 ? '' : 's'}
              </Button>
            </>
          ) : !transfer.file ? (
            <span className={ledger.sectionNote}>Choose an archive to continue</span>
          ) : null}
        </div>
      </SettingsSection>
    </>
  )
}
