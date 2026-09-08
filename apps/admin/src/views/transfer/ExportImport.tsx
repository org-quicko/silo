import { useState } from 'react'
import { Claims } from '@silo/shared/claims'
import { Breadcrumb } from '../../components/navigation/Breadcrumb'
import { Segmented } from '../../components/controls/Segmented'
import { TopBar } from '../shell/TopBar'
import type { Server } from '../servers/server'
import { SettingsAlert } from '../settings/parts/SettingsAlert'
import { SettingsPageHead } from '../settings/parts/SettingsPageHead'
import { useArchiveTransfer } from './use-archive-transfer'
import { CopyServerPanel } from './CopyServer'
import { ExportPanel } from './ExportPanel'
import { ImportPanel } from './ImportPanel'
import styles from './Transfer.module.css'

type Tab = 'export' | 'import' | 'copy'

/**
 * Move an instance in or out: a portable archive, or a direct pull from
 * another running silo — three jobs sharing one page, tabbed rather than
 * stacked so only one is ever in view.
 */
export function ExportImportView({
  server,
  claims,
  onImported,
  onDestinationKeyChanged,
}: {
  server: Server
  claims: string[]
  onImported: () => void
  onDestinationKeyChanged: (key: string) => void
}) {
  const [tab, setTab] = useState<Tab>('export')
  const transfer = useArchiveTransfer(server.url, server.apiKey, onImported)

  const sessionKnown = claims.length > 0
  const canReadAll = Claims.hasInstanceWide(claims, Claims.TransferReadPermissions)
  const canWriteAll = Claims.hasInstanceWide(claims, Claims.TransferWritePermissions)
  // `replace` deletes what it does not carry forward, so the server asks for
  // two further permissions only in that mode. A merge-only key keeps the
  // tab; it just cannot pick Replace.
  const canReplaceAll = Claims.hasInstanceWide(claims, Claims.TransferReplacePermissions)
  const canExport = Claims.has(claims, Claims.TransferExport) && canReadAll
  const canExportKeys = Claims.has(claims, Claims.KeysExport)
  const canImport = Claims.has(claims, Claims.TransferImport) && canWriteAll
  const canImportKeys = Claims.has(claims, Claims.KeysImport)
  const canCopy = Claims.has(claims, Claims.TransferCopy) && canWriteAll

  const tabs = [
    canExport && { value: 'export' as const, label: 'Export' },
    canImport && { value: 'import' as const, label: 'Import' },
    canCopy && { value: 'copy' as const, label: 'Copy from silo' },
  ].filter((t): t is { value: Tab; label: string } => !!t)
  const activeTab = tabs.some((t) => t.value === tab) ? tab : tabs[0]?.value

  return (
    <>
      <TopBar />

      <div className="content">
        <Breadcrumb crumbs={[{ label: server.name }, { label: 'Data Transfer' }]} />

        <SettingsPageHead
          title="Data Transfer"
          sub="Move an instance in or out as a portable archive, or pull one running silo into another."
        />

        {sessionKnown && tabs.length === 0 && (
          <SettingsAlert tone="bad" title="Not available with this key">
            Exporting, importing and copying each need their own claim — none of{' '}
            <code>{Claims.TransferExport}</code>, <code>{Claims.TransferImport}</code> or{' '}
            <code>{Claims.TransferCopy}</code> is held here.
          </SettingsAlert>
        )}

        {activeTab && (
          <>
            <div className={styles.tabRow}>
              <Segmented
                variant="tabs"
                value={activeTab}
                onChange={setTab}
                options={tabs.map((t) => ({ value: t.value, label: t.label }))}
              />
            </div>

            {activeTab === 'export' && (
              <ExportPanel
                server={server}
                transfer={transfer}
                canExportKeys={canExportKeys}
              />
            )}

            {activeTab === 'import' && <ImportPanel transfer={transfer} canReplaceAll={canReplaceAll} />}

            {activeTab === 'copy' && (
              <CopyServerPanel
                destinationUrl={server.url}
                destinationApiKey={server.apiKey}
                onCopied={onImported}
                onDestinationKeyChanged={onDestinationKeyChanged}
                canImportKeys={canImportKeys}
                canReplace={canReplaceAll}
              />
            )}
          </>
        )}
      </div>
    </>
  )
}
