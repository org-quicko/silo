import { Button } from '../../components/buttons/Button'
import { Pill } from '../../components/feedback/Pill'
import { StatRow } from '../../components/data/StatRow'
import { StatTile } from '../../components/data/StatTile'
import passwordStyles from '../../components/controls/PasswordInput.module.css'
import { useState } from 'react'
import { Claims } from '@silo/shared/claims'
import { AlertTriangle, Check, Copy, Eye, EyeOff, KeyRound, RefreshCw } from 'lucide-react'
import { api } from '../../api/silo-api'
import type { ImportResult } from '../../api/types/import-result'
import { Toggle } from '../../components/controls/Toggle'
import styles from './Transfer.module.css'

type Mode = 'merge' | 'replace'
type Prefer = '' | 'local' | 'remote'

export function CopyServerPanel({
  destinationUrl,
  destinationApiKey,
  onCopied,
  onDestinationKeyChanged,
  canImportKeys,
  canReplace,
}: {
  destinationUrl: string
  destinationApiKey: string
  onCopied: () => void
  onDestinationKeyChanged: (key: string) => void
  canImportKeys: boolean
  canReplace: boolean
}) {
  const [sourceUrl, setSourceUrl] = useState('')
  const [sourceApiKey, setSourceApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [mode, setMode] = useState<Mode>('merge')
  const [prefer, setPrefer] = useState<Prefer>('')
  const [withKeys, setWithKeys] = useState(false)
  const [preview, setPreview] = useState<ImportResult | null>(null)
  const [applied, setApplied] = useState<ImportResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const invalidatePreview = () => {
    setPreview(null)
    setApplied(null)
    setError('')
  }

  const copy = async (dryRun: boolean) => {
    const cleanUrl = sourceUrl.trim()
    const cleanKey = sourceApiKey.trim()
    if (!cleanUrl || !cleanKey) {
      setError('Enter the source server URL and a key that permits export.')
      return
    }

    setBusy(true)
    setError('')
    if (dryRun) {
      setPreview(null)
      setApplied(null)
    }
    try {
      const result = await api.transfer.copyFromServer(destinationUrl, destinationApiKey, {
        sourceUrl: cleanUrl,
        sourceApiKey: cleanKey,
        mode,
        prefer,
        withKeys,
        dryRun,
      })
      if (dryRun) {
        setPreview(result)
      } else {
        setApplied(result)
        setPreview(null)
        if (withKeys && mode === 'replace') {
          onDestinationKeyChanged(cleanKey)
        } else {
          onCopied()
        }
      }
    } catch (caught: any) {
      setError(caught.message || (dryRun ? 'Copy preview failed' : 'Copy failed'))
    } finally {
      setBusy(false)
    }
  }

  const result = applied || preview

  return (
    <div className={`${styles.panel} ${styles.copyPanel}`}>
      <div className={styles.header}>
        <div className={styles.heading}>
          <Copy size={17} color="var(--accent)" />
          <span className={styles.title}>Copy from another silo</span>
        </div>
        {preview && <Pill tone="warn" dot>Preview — no changes written</Pill>}
        {applied && <Pill tone="ok"><Check size={12} /> Copy applied</Pill>}
      </div>

      <div className={styles.body}>
        <p>
          Pull all schemas, entries, and media directly from a running silo. The source key is used only for this
          transfer and must hold the required export claims.
        </p>

        <div className={styles.sourceFields}>
          <div className="field">
            <label className="field-label" htmlFor="copy-source-url">Source server URL</label>
            <input
              id="copy-source-url"
              className="input"
              type="url"
              placeholder="https://old-silo.example.com"
              value={sourceUrl}
              onChange={(e) => {
                setSourceUrl(e.target.value)
                invalidatePreview()
              }}
              disabled={busy}
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="copy-source-key">
              <KeyRound size={12} /> Source API key
            </label>
            <div className={passwordStyles.wrapper}>
              <input
                id="copy-source-key"
                className="input"
                type={showKey ? 'text' : 'password'}
                placeholder="silo_..."
                value={sourceApiKey}
                onChange={(e) => {
                  setSourceApiKey(e.target.value)
                  invalidatePreview()
                }}
                disabled={busy}
              />
              <button
                type="button"
                className={passwordStyles.toggle}
                onClick={() => setShowKey(!showKey)}
                title={showKey ? 'Hide key' : 'Show key'}
              >
                {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
        </div>

        <div className={styles.options}>
          <div className="field">
            <label className="field-label" htmlFor="copy-mode">Mode</label>
            <select
              id="copy-mode"
              className="input"
              value={mode}
              onChange={(e) => {
                setMode(e.target.value as Mode)
                invalidatePreview()
              }}
              disabled={busy}
            >
              <option value="merge">Merge</option>
              <option value="replace" disabled={!canReplace}>
                Replace source collections{canReplace ? '' : ' — needs instance-wide delete'}
              </option>
            </select>
          </div>
          {mode === 'merge' && (
            <div className="field">
              <label className="field-label" htmlFor="copy-prefer">On conflicts</label>
              <select
                id="copy-prefer"
                className="input"
                value={prefer}
                onChange={(e) => {
                  setPrefer(e.target.value as Prefer)
                  invalidatePreview()
                }}
                disabled={busy}
              >
                <option value="">Newest wins</option>
                <option value="local">Keep destination</option>
                <option value="remote">Use source</option>
              </select>
            </div>
          )}
          <label className={styles.keyToggle}>
            <Toggle
              size="sm"
              on={withKeys}
              disabled={!canImportKeys}
              onChange={(value) => {
                setWithKeys(value)
                invalidatePreview()
              }}
            />
            <span>
              <b>{withKeys ? 'Data + API keys' : 'Data only'}</b>
              <small>{canImportKeys ? (withKeys ? 'Copy stored key hashes too' : 'Keep destination keys unchanged') : `Missing ${Claims.KeysImport} claim`}</small>
            </span>
          </label>
        </div>

        {withKeys && mode === 'replace' && (
          <div className="banner banner-warn">
            <AlertTriangle size={15} />
            <span>
              Destination API keys will be replaced by the source keys. This browser will switch to the source key
              after the copy completes.
            </span>
          </div>
        )}

        {error && (
          <div className={`banner banner-bad ${styles.errorBanner}`}>
            <span>{error}</span>
          </div>
        )}

        {busy && !result && (
          <div className={styles.progress}>
            <RefreshCw size={14} className="spin" /> {preview ? 'Copying…' : 'Reading and comparing source…'}
          </div>
        )}

        {result && (
          <>
            <StatRow>
              <StatTile n={result.added} label="to create" tone="ok" prefix="+" />
              <StatTile n={result.updated} label="to update" tone="warn" prefix="~" />
              <StatTile n={result.deleted} label="to delete" tone="bad" />
              <StatTile n={result.skipped} label="unchanged" tone="muted" />
            </StatRow>
            {applied && (
              <div className="banner banner-ok">
                <Check size={15} /> Copy completed in <b>{applied.mode}</b> mode.
              </div>
            )}
          </>
        )}

        <div className={styles.actions}>
          {preview && (
            <span>
              The source is exported again when you apply, so rapidly changing data may differ slightly from this preview.
            </span>
          )}
          <div>
            {preview && (
              <Button variant="secondary" onClick={invalidatePreview} disabled={busy}>
                Cancel
              </Button>
            )}
            <Button
               variant="primary"
              onClick={() => copy(preview === null)}
              disabled={busy || !sourceUrl.trim() || !sourceApiKey.trim() || applied !== null}
            >
              {busy ? <RefreshCw size={14} className="spin" /> : preview ? <Check size={14} /> : <Copy size={14} />}
              {busy ? 'Working…' : preview ? 'Apply copy' : applied ? 'Copy complete' : 'Preview copy'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
