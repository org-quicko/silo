import { Button } from '../../components/buttons/Button'
import { Pill } from '../../components/feedback/Pill'
import { Breadcrumb } from '../../components/navigation/Breadcrumb'
import { StatRow } from '../../components/data/StatRow'
import { StatTile } from '../../components/data/StatTile'
import { Upload, Download, Check, RefreshCw, X } from 'lucide-react'
import { Claims } from '@silo/shared/claims'
import { useArchiveTransfer } from './use-archive-transfer'
import type { ScopeRef } from '../../api/types/scope-ref'
import { Toggle } from '../../components/controls/Toggle'
import { TopBar } from '../shell/TopBar'
import { SmartSearch } from '../search/SmartSearch'
import type { PaletteSeed } from '../search/palette-seed'
import { CopyServerPanel } from './CopyServer'
import styles from './Transfer.module.css'
import type { SessionBadge } from '../shell/session-badge'

type Mode = 'merge' | 'replace'
type Prefer = '' | 'local' | 'remote'

export function ExportImportView({
  serverId,
  url: serverUrl,
  apiKey,
  scope,
  smartCollections,
  claims,
  session,
  collectionCount,
  onOpenPalette,
  onNavigateToCollection,
  onImported,
  onDestinationKeyChanged,
}: {
  serverId: string
  url: string
  apiKey: string
  scope: ScopeRef | null
  smartCollections: readonly { name: string; count: number | null; schema?: any }[]
  claims: string[]
  session: SessionBadge
  collectionCount: number
  onOpenPalette: (seed: PaletteSeed) => void
  onNavigateToCollection: (name: string, q: string) => void
  onImported: () => void
  onDestinationKeyChanged: (key: string) => void
}) {
  const transfer = useArchiveTransfer(serverUrl, apiKey, onImported)

  const canReadAll = Claims.hasInstanceWide(claims, Claims.TransferReadPermissions)
  const canWriteAll = Claims.hasInstanceWide(claims, Claims.TransferWritePermissions)
  // `replace` deletes what it does not carry forward, so the server asks for
  // two further permissions only in that mode. A merge-only key keeps the
  // panel; it just cannot pick Replace.
  const canReplaceAll = Claims.hasInstanceWide(claims, Claims.TransferReplacePermissions)
  const canExport = Claims.has(claims, Claims.TransferExport) && canReadAll
  const canExportKeys = Claims.has(claims, Claims.KeysExport)
  const canImport = Claims.has(claims, Claims.TransferImport) && canWriteAll
  const canImportKeys = Claims.has(claims, Claims.KeysImport)
  const canCopy = Claims.has(claims, Claims.TransferCopy) && canWriteAll


  return (
    <>
      <TopBar
        search={
          <SmartSearch
            serverId={serverId}
            scope={scope}
            collection={null}
            collections={smartCollections}
            onNavigateToCollection={onNavigateToCollection}
            onOpenPalette={onOpenPalette}
          />
        }
        session={session}
      />

      <div className="content">
        <Breadcrumb crumbs={[{ label: 'Admin' }, { label: 'Data transfer' }]} />
        <div className="page-head">
          <div className="page-title-group">
            <h2 className="page-title">Data transfer</h2>
            <span className="page-sub">
              Export or import a portable archive, or copy directly from another running silo.
            </span>
          </div>
        </div>

        <div className={styles.grid}>
          {/* Export */}
          {canExport && <div className={`${styles.panel} ${styles.exportPanel}`}>
            <div className={styles.header}>
              <div className={styles.heading}>
                <Upload size={17} color="var(--accent)" />
                <span className={styles.title}>Export</span>
              </div>
            </div>
            <div className={styles.body}>
              <p>Download the whole instance — schemas and entries — as one portable tar.gz archive.</p>
              <div className={styles.checklist}>
                <div className={`${styles.checkItem} ${styles.checked}`}>
                  <span className={styles.checkbox}>
                    <Check size={11} strokeWidth={3} />
                  </span>
                  <span className={styles.checkLabel}>All collections</span>
                  <span className={styles.checkCount}>{collectionCount}</span>
                </div>
                <label className={`${styles.checkItem} ${transfer.withKeys ? styles.checked : ''} ${!canExportKeys ? styles.disabled : ''}`} onClick={() => canExportKeys && transfer.setWithKeys(!transfer.withKeys)} title={!canExportKeys ? `Missing ${Claims.KeysExport} claim` : undefined}>
                  <span className={styles.checkbox}>{transfer.withKeys && <Check size={11} strokeWidth={3} />}</span>
                  <span className={styles.checkLabel}>Include API keys (hashes only)</span>
                </label>
              </div>
              <div className={styles.fill} />
              <Button className={styles.fullWidth} variant="primary" onClick={transfer.exportArchive} disabled={transfer.exporting}>
                <Download size={15} /> {transfer.exporting ? 'Preparing…' : 'Download silo-export.tar.gz'}
              </Button>
            </div>
          </div>}

          {/* Import */}
          {canImport && <div className={`${styles.panel} ${styles.importPanel}`}>
            <div className={styles.header}>
              <div className={styles.heading}>
                <Download size={17} color="var(--accent)" />
                <span className={styles.title}>Import</span>
                {transfer.file && <span className={styles.file}>{transfer.file.name}</span>}
              </div>
              {transfer.file && !transfer.applied && <Pill tone="warn" dot>Dry run — no changes written</Pill>}
              {transfer.applied && <Pill tone="ok"><Check size={12} /> Import transfer.applied</Pill>}
            </div>
            <div className={styles.body}>
              {/* options */}
              <div className={styles.importOptions}>
                <div className={`field ${styles.modeField}`}>
                  <label className="field-label">Mode</label>
                  <select
                    className="input"
                    value={transfer.mode}
                    onChange={(event) => transfer.changeMode(event.target.value as Mode)}
                  >
                    <option value="merge">Merge</option>
                    <option value="replace" disabled={!canReplaceAll}>
                      Replace{canReplaceAll ? '' : ' — needs instance-wide delete'}
                    </option>
                  </select>
                </div>
                {transfer.mode === 'merge' && (
                  <div className={`field ${styles.preferField}`}>
                    <label className="field-label">Prefer</label>
                    <select
                      className="input"
                      value={transfer.prefer}
                      onChange={(event) => transfer.changePrefer(event.target.value as Prefer)}
                    >
                      <option value="">Newest wins</option>
                      <option value="local">Local</option>
                      <option value="remote">Remote</option>
                    </select>
                  </div>
                )}
                <label className={styles.validateToggle}>
                  <Toggle
                    size="sm"
                    on={transfer.validate}
                    onChange={transfer.changeValidate}
                  />
                  <span className={styles.validateLabel}>Validate on import</span>
                </label>
                <div className={styles.fill} />
                {!transfer.file ? (
                  <Button variant="secondary" onClick={() => transfer.fileInput.current?.click()}>
                    <Upload size={14} /> Choose archive…
                  </Button>
                ) : (
                  <Button variant="secondary" size="sm" onClick={transfer.reset}>
                    <X size={13} /> Clear
                  </Button>
                )}
                <input ref={transfer.fileInput} type="transfer.file" accept=".gz,.tgz,.tar.gz" className={styles.hiddenInput} onChange={transfer.pickFile} />
              </div>

              {transfer.error && (
                <div className={`banner banner-bad ${styles.errorBanner}`}>
                  <span>{transfer.error}</span>
                </div>
              )}

              {transfer.busy && !transfer.preview && !transfer.applied && (
                <div className={styles.progress}>
                  <RefreshCw size={14} className="spin" /> Analyzing archive…
                </div>
              )}

              {(transfer.preview || transfer.applied) && (
                <>
                  <StatRow>
                    <StatTile n={(transfer.preview || transfer.applied)!.added} label="to create" tone="ok" prefix="+" />
                    <StatTile n={(transfer.preview || transfer.applied)!.updated} label="to update" tone="warn" prefix="~" />
                    <StatTile n={(transfer.preview || transfer.applied)!.deleted} label="to delete" tone="bad" />
                    <StatTile n={(transfer.preview || transfer.applied)!.skipped} label="unchanged" tone="muted" />
                  </StatRow>

                  {transfer.applied ? (
                    <div className="banner banner-ok">
                      <Check size={16} color="var(--ok)" />
                      <span className={styles.successText}>
                        Import applied in <b>{transfer.applied.mode}</b> mode.
                      </span>
                    </div>
                  ) : (
                    <div className={styles.previewActions}>
                      <span className={styles.previewMeta}>
                        Mode <b>{transfer.mode}</b>
                        {transfer.mode === 'merge' && transfer.prefer ? ` · transfer.prefer ${transfer.prefer}` : ''}
                        {transfer.validate ? ' · validated' : ''}
                      </span>
                      <div className={styles.previewButtons}>
                        <Button variant="secondary" onClick={transfer.reset}>
                          Cancel
                        </Button>
                        <Button variant="primary" onClick={transfer.apply} disabled={transfer.busy || transfer.changeCount === 0 || (transfer.mode === 'replace' && !canReplaceAll)}>
                          <Check size={14} /> Apply {transfer.changeCount} change{transfer.changeCount === 1 ? '' : 's'}
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}

              {!transfer.file && !transfer.busy && (
                <p className={styles.archiveHint}>
                  Choose a <span className="mono">.tar.gz</span> archive to preview the changes before applying.
                </p>
              )}
            </div>
          </div>}
        </div>

        {canCopy && <CopyServerPanel
          destinationUrl={serverUrl}
          destinationApiKey={apiKey}
          onCopied={onImported}
          onDestinationKeyChanged={onDestinationKeyChanged}
          canImportKeys={canImportKeys}
          canReplace={canReplaceAll}
        />}
      </div>
    </>
  )
}
