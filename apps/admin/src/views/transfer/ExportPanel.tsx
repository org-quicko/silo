import { useState } from 'react'
import { Download } from 'lucide-react'
import { Button } from '../../components/buttons/Button'
import { Toggle } from '../../components/controls/Toggle'
import { Claims } from '@silo/shared/claims'
import type { useArchiveTransfer } from './use-archive-transfer'
import { ArchiveName } from './archive-name'
import { MediaModeRow } from './MediaModeRow'
import { TransferCoverageSheet } from './TransferCoverageSheet'
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
  const [showingCoverage, setShowingCoverage] = useState(false)
  const rules = transfer.exportInclude
  const whole = rules.length === 0
  const plural = (count: number, one: string, many = `${one}s`) =>
    `${count} ${count === 1 ? one : many}`

  const facts: Fact[] = tree
    ? [
        {
          key: 'Covering',
          // A count and the projects, never the whole list: the row ellipsises,
          // so forty-six rules on one line says nothing at all. The sheet
          // beside it is where they are read.
          value: whole
            ? `The whole instance, ${plural(TransferTrees.scopes(tree), 'environment')}`
            : ExportPanel.coverage(rules),
          plain: true,
          action: whole ? undefined : (
            <button
              type="button"
              className={ledger.factLink}
              onClick={() => setShowingCoverage(true)}
            >
              Show all
            </button>
          ),
        },
        {
          key: 'Collections',
          value: whole
            ? plural(TransferTrees.collectionNames(tree).length, 'collection')
            : plural(rules.length, 'selection'),
          plain: true,
        },
        {
          key: 'Entries',
          value: whole ? String(TransferTrees.entries(tree)) : 'Counted on export',
          plain: true,
        },
        {
          key: 'Media',
          value:
            transfer.exportMedia === 'none'
              ? 'Catalog only, no files'
              : transfer.exportMedia === 'referenced'
                ? 'Only files the exported entries use'
                : plural(tree.media, 'file'),
          plain: true,
        },
        { key: 'Archive', value: ArchiveName.Pattern, plain: true },
      ]
    : [{ key: 'Covering', value: 'Counting…', plain: true }]

  return (
    <>
      <SettingsSection title="What to export" divider={false}>
        <SettingsRow
          label="Scope"
          help={
            whole
              ? 'Everything is checked. Uncheck to move only part of the instance.'
              : `${plural(rules.length, 'selection')}. Check everything to move the whole instance.`
          }
          stack
        >
          <TransferScopePicker
            tree={tree}
            rules={rules}
            onChange={transfer.setExportInclude}
            disabled={transfer.exporting}
          />
        </SettingsRow>

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

      {showingCoverage && (
        <TransferCoverageSheet rules={rules} onClose={() => setShowingCoverage(false)} />
      )}
    </>
  )
}

/**
 * The one line a narrowed selection gets before the sheet takes over.
 *
 * The projects it touches rather than the rules themselves, capped at three: a
 * reader checks "did I pick the right projects" long before they check the
 * forty-six rules underneath them.
 */
ExportPanel.coverage = (rules: string[]): string => {
  const projects = [...new Set(rules.map((rule) => rule.split('/')[0]!))].sort()
  const shown = projects.slice(0, 3).join(', ')
  const rest = projects.length - 3
  return rest > 0 ? `${shown} and ${rest} more` : shown
}
