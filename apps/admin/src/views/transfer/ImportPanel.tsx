import { Check, RefreshCw } from 'lucide-react'
import { Button } from '../../components/buttons/Button'
import { Pill } from '../../components/feedback/Pill'
import { StatRow } from '../../components/data/StatRow'
import { StatTile } from '../../components/data/StatTile'
import { Segmented } from '../../components/controls/Segmented'
import type { ImportRejection } from '../../api/types/import-rejection'
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
            {result.rejected > 0 && <StatTile n={result.rejected} label="rejected" tone="bad" />}
          </StatRow>
        )}

        {/* Only after an apply. A dry run writes no schemas, so it has nothing
            to judge entries against and always reports zero. */}
        {result && result.rejected > 0 && (
          <SettingsAlert
            tone="bad"
            title={`${result.rejected} ${result.rejected === 1 ? 'entry' : 'entries'} did not match a schema`}
          >
            Not imported; everything else was. Affected:{' '}
            <span className="mono">{ImportPanel.rejectedCollections(result.rejections)}</span>.
          </SettingsAlert>
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

/**
 * The collections a rejection list touches, with a count each.
 *
 * Named rather than listed entry by entry: a schema tightened in one place
 * rejects every row under it, so the per-entry list is the same sentence a
 * thousand times. The collection and the count are what an operator acts on,
 * and the full list is in the API response for anyone who wants it.
 */
ImportPanel.rejectedCollections = (rejections: ImportRejection[]): string => {
  const counts = new Map<string, number>()
  for (const rejection of rejections) {
    const key = `${rejection.project}/${rejection.env}/${rejection.collection}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts].map(([name, count]) => `${name} (${count})`).join(', ')
}
