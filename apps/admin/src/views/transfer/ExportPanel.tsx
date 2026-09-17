import { Download } from 'lucide-react'
import { Button } from '../../components/buttons/Button'
import { Toggle } from '../../components/controls/Toggle'
import { Claims } from '@silo/shared/claims'
import type { useArchiveTransfer } from './use-archive-transfer'
import { ArchiveName } from './archive-name'
import { MediaModeRow } from './MediaModeRow'
import { TransferScopePicker } from './TransferScopePicker'
import { TransferTrees } from './transfer-tree'
import { useTransferTree } from './use-transfer-tree'
import { FactList, type Fact } from '../settings/parts/FactList'
import { SettingsAlert } from '../settings/parts/SettingsAlert'
import { SettingsRow } from '../settings/parts/SettingsRow'
import { SettingsSection } from '../settings/parts/SettingsSection'
import ledger from '../settings/parts/SettingsLedger.module.css'

/**
 * Download the instance, or a named part of it, as one portable archive.
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
  const tree = useTransferTree(server.url, server.apiKey, true)
  const whole = transfer.exportInclude.length === 0
  const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many)

  const facts: Fact[] = tree
    ? [
        {
          key: 'Covering',
          value: whole
            ? `The whole instance, ${TransferTrees.scopes(tree)} ${plural(TransferTrees.scopes(tree), 'environment')}`
            : transfer.exportInclude.join(', '),
          plain: true,
        },
        {
          key: 'Collections',
          value: whole
            ? `${TransferTrees.collectionNames(tree).length}: ${TransferTrees.collectionNames(tree).join(', ')}`
            : `${transfer.exportInclude.length} ${plural(transfer.exportInclude.length, 'selection')}`,
          plain: true,
        },
        { key: 'Entries', value: whole ? String(TransferTrees.entries(tree)) : 'Counted on export', plain: true },
        {
          key: 'Media',
          value:
            transfer.exportMedia === 'none'
              ? 'Catalog only, no files'
              : transfer.exportMedia === 'referenced'
                ? 'Only files the exported entries use'
                : `${tree.media} ${plural(tree.media, 'file')}`,
          plain: true,
        },
        { key: 'Archive', value: ArchiveName.of() },
      ]
    : [{ key: 'Covering', value: 'Counting…', plain: true }]

  return (
    <>
      <SettingsSection title="What to export" divider={false}>
        <SettingsRow
          label="Scope"
          help="Everything is checked by default. Uncheck to move only part of the instance."
        >
          <span className={ledger.sectionNote}>
            {whole ? 'The whole instance' : `${transfer.exportInclude.length} selected`}
          </span>
        </SettingsRow>

        <TransferScopePicker
          tree={tree}
          rules={transfer.exportInclude}
          onChange={transfer.setExportInclude}
          disabled={transfer.exporting}
        />

        <MediaModeRow
          value={transfer.exportMedia}
          onChange={transfer.setExportMedia}
          disabled={transfer.exporting}
        />

        <SettingsRow
          label="Include API keys"
          help={
            canExportKeys
              ? 'Hashes only, so a restored key still has to be reissued.'
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
      </SettingsSection>

      <SettingsSection title="What the archive contains">
        <FactList facts={facts} />

        {tree?.partial && (
          <SettingsAlert tone="warn" title="Counted with what this key can read">
            One or more scopes refused to list, so the numbers above are a floor.
          </SettingsAlert>
        )}

        {transfer.error && (
          <SettingsAlert tone="bad" title="Export failed">
            {transfer.error}
          </SettingsAlert>
        )}

        <div className={ledger.sectionActions}>
          <Button variant="primary" onClick={transfer.exportArchive} disabled={transfer.exporting}>
            <Download size={14} /> {transfer.exporting ? 'Preparing…' : 'Download archive'}
          </Button>
        </div>
      </SettingsSection>
    </>
  )
}
