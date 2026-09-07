import { Download } from 'lucide-react'
import { Button } from '../../components/buttons/Button'
import { Toggle } from '../../components/controls/Toggle'
import { Claims } from '@silo/shared/claims'
import type { useArchiveTransfer } from './use-archive-transfer'
import { ArchiveName } from './archive-name'
import { useArchiveContents } from './use-archive-contents'
import { FactList, type Fact } from '../settings/parts/FactList'
import { SettingsRow } from '../settings/parts/SettingsRow'
import { SettingsSection } from '../settings/parts/SettingsSection'
import ledger from '../settings/parts/SettingsLedger.module.css'

/**
 * Download the whole instance as one portable archive.
 *
 * What is in it is stated before the button rather than after the download, so
 * "the whole instance" is a list of numbers an operator can check against what
 * they expected rather than a claim they have to trust.
 */
export function ExportPanel({
  server,
  transfer,
  canExportKeys,
}: {
  server: { url: string; apiKey: string }
  transfer: ReturnType<typeof useArchiveTransfer>
  canExportKeys: boolean
}) {
  const contents = useArchiveContents(server.url, server.apiKey, true)

  const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many)
  const facts: Fact[] = contents
    ? [
        {
          key: 'Collections',
          value: contents.collections.length
            ? `${contents.collections.length} — ${contents.collections.join(', ')}`
            : 'none',
          plain: true,
        },
        { key: 'Entries', value: String(contents.entries), plain: true },
        {
          key: 'Schemas',
          // One schema per collection, by definition — not a second count.
          value: String(contents.collections.length),
          plain: true,
        },
        {
          key: 'Media',
          value: `${contents.media} ${plural(contents.media, 'file')}`,
          plain: true,
        },
        { key: 'Archive', value: ArchiveName.of() },
      ]
    : [{ key: 'Collections', value: 'Counting…', plain: true }]

  return (
    <SettingsSection title="What the archive contains" divider={false}>
      <FactList facts={facts} />

      <SettingsRow
        label="Include API keys"
        help={
          canExportKeys
            ? 'Hashes only — the secrets were never stored, so a restored key still has to be reissued.'
            : `Missing the ${Claims.KeysExport} claim.`
        }
        inline
      >
        <Toggle
          on={transfer.withKeys}
          disabled={!canExportKeys}
          onChange={transfer.setWithKeys}
        />
      </SettingsRow>

      <div className={ledger.sectionActions}>
        <Button variant="primary" onClick={transfer.exportArchive} disabled={transfer.exporting}>
          <Download size={14} /> {transfer.exporting ? 'Preparing…' : 'Download archive'}
        </Button>
      </div>
    </SettingsSection>
  )
}
