import { Button } from '../../components/Button'
import { Pill } from '../../components/Pill'
import { StatRow } from '../../components/StatRow'
import { StatTile } from '../../components/StatTile'
import { useRef, useState } from 'react'
import { Upload, Download, Check, RefreshCw, X } from 'lucide-react'
import { Claims } from '@silo/shared/claims'
import { api } from '../../api/api-client'
import type { ImportResult } from '../../api/types/import-result'
import { Toggle } from '../../components/Toggle'
import { TopBar } from '../shell/TopBar'
import { CopyServerPanel } from './CopyServer'
import styles from './Transfer.module.css'

type Mode = 'merge' | 'replace'
type Prefer = '' | 'local' | 'remote'

export function ExportImportView({
  url: serverUrl,
  apiKey,
  claims,
  session,
  onLock,
  collectionCount,
  onImported,
  onDestinationKeyChanged,
}: {
  url: string
  apiKey: string
  claims: string[]
  session: string
  onLock: () => void
  collectionCount: number
  onImported: () => void
  onDestinationKeyChanged: (key: string) => void
}) {
  const [withKeys, setWithKeys] = useState(false)
  const [exporting, setExporting] = useState(false)

  const [mode, setMode] = useState<Mode>('merge')
  const [prefer, setPrefer] = useState<Prefer>('')
  const [validate, setValidate] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [dry, setDry] = useState<ImportResult | null>(null)
  const [applied, setApplied] = useState<ImportResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  // An archive spans every project and env, so the server requires the
  // matching collection permissions at instance scope alongside the transfer
  // claim. Gate on the same rule rather than offering a button that 403s.
  const canReadAll = Claims.hasInstanceWide(claims, Claims.TransferReadPermissions)
  const canWriteAll = Claims.hasInstanceWide(claims, Claims.TransferWritePermissions)
  const canExport = Claims.has(claims, Claims.TransferExport) && canReadAll
  const canExportKeys = Claims.has(claims, Claims.KeysExport)
  const canImport = Claims.has(claims, Claims.TransferImport) && canWriteAll
  const canImportKeys = Claims.has(claims, Claims.KeysImport)
  const canCopy = Claims.has(claims, Claims.TransferCopy) && canWriteAll

  const doExport = async () => {
    setExporting(true)
    try {
      const blob = await api.exportArchive(serverUrl, apiKey, withKeys)
      const downloadUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = downloadUrl
      a.download = `silo-export-${new Date().toISOString().slice(0, 10)}.tar.gz`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(downloadUrl)
    } catch (e: any) {
      alert(e.message || 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  const runDryRun = async (f: File, opts?: { mode?: Mode; prefer?: Prefer; validate?: boolean }) => {
    setBusy(true)
    setError('')
    setApplied(null)
    setDry(null)
    try {
      const res = await api.importArchive(serverUrl, apiKey, f, {
        mode: opts?.mode ?? mode,
        prefer: opts?.prefer ?? prefer,
        validate: opts?.validate ?? validate,
        dryRun: true,
      })
      setDry(res)
    } catch (e: any) {
      setError(e.message || 'Import preview failed')
    } finally {
      setBusy(false)
    }
  }

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    setFile(f)
    runDryRun(f)
    e.target.value = ''
  }

  const apply = async () => {
    if (!file) return
    setBusy(true)
    setError('')
    try {
      const res = await api.importArchive(serverUrl, apiKey, file, { mode, prefer, validate, dryRun: false })
      setApplied(res)
      setDry(null)
      onImported()
    } catch (e: any) {
      setError(e.message || 'Import failed')
    } finally {
      setBusy(false)
    }
  }

  const reset = () => {
    setFile(null)
    setDry(null)
    setApplied(null)
    setError('')
  }

  const changeCount = dry ? dry.added + dry.updated + dry.deleted : 0

  return (
    <>
      <TopBar crumbs={[{ label: 'Admin' }, { label: 'Data transfer' }]} session={session} onLock={onLock} />

      <div className="content">
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
                <label className={`${styles.checkItem} ${withKeys ? styles.checked : ''} ${!canExportKeys ? styles.disabled : ''}`} onClick={() => canExportKeys && setWithKeys(!withKeys)} title={!canExportKeys ? `Missing ${Claims.KeysExport} claim` : undefined}>
                  <span className={styles.checkbox}>{withKeys && <Check size={11} strokeWidth={3} />}</span>
                  <span className={styles.checkLabel}>Include API keys (hashes only)</span>
                </label>
              </div>
              <div className={styles.fill} />
              <Button className={styles.fullWidth} variant="primary" onClick={doExport} disabled={exporting}>
                <Download size={15} /> {exporting ? 'Preparing…' : 'Download silo-export.tar.gz'}
              </Button>
            </div>
          </div>}

          {/* Import */}
          {canImport && <div className={`${styles.panel} ${styles.importPanel}`}>
            <div className={styles.header}>
              <div className={styles.heading}>
                <Download size={17} color="var(--accent)" />
                <span className={styles.title}>Import</span>
                {file && <span className={styles.file}>{file.name}</span>}
              </div>
              {file && !applied && <Pill tone="warn" dot>Dry run — no changes written</Pill>}
              {applied && <Pill tone="ok"><Check size={12} /> Import applied</Pill>}
            </div>
            <div className={styles.body}>
              {/* options */}
              <div className={styles.importOptions}>
                <div className={`field ${styles.modeField}`}>
                  <label className="field-label">Mode</label>
                  <select
                    className="input"
                    value={mode}
                    onChange={(e) => {
                      const m = e.target.value as Mode
                      setMode(m)
                      if (file) runDryRun(file, { mode: m })
                    }}
                  >
                    <option value="merge">Merge</option>
                    <option value="replace">Replace</option>
                  </select>
                </div>
                {mode === 'merge' && (
                  <div className={`field ${styles.preferField}`}>
                    <label className="field-label">Prefer</label>
                    <select
                      className="input"
                      value={prefer}
                      onChange={(e) => {
                        const p = e.target.value as Prefer
                        setPrefer(p)
                        if (file) runDryRun(file, { prefer: p })
                      }}
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
                    on={validate}
                    onChange={(v) => {
                      setValidate(v)
                      if (file) runDryRun(file, { validate: v })
                    }}
                  />
                  <span className={styles.validateLabel}>Validate on import</span>
                </label>
                <div className={styles.fill} />
                {!file ? (
                  <Button variant="secondary" onClick={() => fileInput.current?.click()}>
                    <Upload size={14} /> Choose archive…
                  </Button>
                ) : (
                  <Button variant="secondary" size="sm" onClick={reset}>
                    <X size={13} /> Clear
                  </Button>
                )}
                <input ref={fileInput} type="file" accept=".gz,.tgz,.tar.gz" className={styles.hiddenInput} onChange={onPick} />
              </div>

              {error && (
                <div className={`banner banner-bad ${styles.errorBanner}`}>
                  <span>{error}</span>
                </div>
              )}

              {busy && !dry && !applied && (
                <div className={styles.progress}>
                  <RefreshCw size={14} className="spin" /> Analyzing archive…
                </div>
              )}

              {(dry || applied) && (
                <>
                  <StatRow>
                    <StatTile n={(dry || applied)!.added} label="to create" tone="ok" prefix="+" />
                    <StatTile n={(dry || applied)!.updated} label="to update" tone="warn" prefix="~" />
                    <StatTile n={(dry || applied)!.deleted} label="to delete" tone="bad" />
                    <StatTile n={(dry || applied)!.skipped} label="unchanged" tone="muted" />
                  </StatRow>

                  {applied ? (
                    <div className="banner banner-ok">
                      <Check size={16} color="var(--ok)" />
                      <span className={styles.successText}>
                        Import applied in <b>{applied.mode}</b> mode.
                      </span>
                    </div>
                  ) : (
                    <div className={styles.previewActions}>
                      <span className={styles.previewMeta}>
                        Mode <b>{mode}</b>
                        {mode === 'merge' && prefer ? ` · prefer ${prefer}` : ''}
                        {validate ? ' · validated' : ''}
                      </span>
                      <div className={styles.previewButtons}>
                        <Button variant="secondary" onClick={reset}>
                          Cancel
                        </Button>
                        <Button variant="primary" onClick={apply} disabled={busy || changeCount === 0}>
                          <Check size={14} /> Apply {changeCount} change{changeCount === 1 ? '' : 's'}
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}

              {!file && !busy && (
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
        />}
      </div>
    </>
  )
}
