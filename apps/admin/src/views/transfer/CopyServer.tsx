import { useState } from 'react'
import { Check, Copy, Eye, EyeOff, RefreshCw } from 'lucide-react'
import { Button } from '../../components/buttons/Button'
import { Pill } from '../../components/feedback/Pill'
import { StatRow } from '../../components/data/StatRow'
import { StatTile } from '../../components/data/StatTile'
import { Segmented } from '../../components/controls/Segmented'
import { Toggle } from '../../components/controls/Toggle'
import passwordStyles from '../../components/controls/PasswordInput.module.css'
import { Claims } from '@silo/shared/claims'
import { api } from '../../api/silo-api'
import type { ImportResult } from '../../api/types/import-result'
import { SettingsAlert } from '../settings/parts/SettingsAlert'
import { SettingsRow } from '../settings/parts/SettingsRow'
import { SettingsSection } from '../settings/parts/SettingsSection'
import ledger from '../settings/parts/SettingsLedger.module.css'

type Mode = 'merge' | 'replace'
type Prefer = '' | 'local' | 'remote'

/**
 * Pull another running silo's data straight in, no archive in the middle.
 *
 * The source key never touches storage — it rides one request and is gone —
 * so re-entering it after a failed attempt is the expected shape of this form,
 * not a papercut to fix.
 */
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
    <>
      <SettingsSection title="Source silo">
        <SettingsRow label="Server URL" htmlFor="copy-source-url">
          <input
            id="copy-source-url"
            className={`${ledger.field} ${ledger.fieldMono}`}
            type="url"
            placeholder="https://old-silo.example.com"
            value={sourceUrl}
            onChange={(event) => {
              setSourceUrl(event.target.value)
              invalidatePreview()
            }}
            disabled={busy}
          />
        </SettingsRow>

        <SettingsRow
          label="API key"
          htmlFor="copy-source-key"
          help="Used only for this transfer, never stored. Needs export claims on the source."
        >
          <div className={passwordStyles.wrapper}>
            <input
              id="copy-source-key"
              className={`${ledger.field} ${ledger.fieldMono}`}
              type={showKey ? 'text' : 'password'}
              placeholder="silo_…"
              value={sourceApiKey}
              onChange={(event) => {
                setSourceApiKey(event.target.value)
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
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="What comes across">
        <SettingsRow label="Mode">
          <Segmented
            variant="fit"
            value={mode}
            disabled={busy}
            onChange={(next) => {
              setMode(next as Mode)
              invalidatePreview()
            }}
            options={[
              { value: 'merge', label: 'Merge' },
              {
                value: 'replace',
                label: canReplace ? 'Replace source collections' : 'Replace — needs instance-wide delete',
              },
            ]}
          />
        </SettingsRow>

        {mode === 'merge' && (
          <SettingsRow label="On conflicts">
            <select
              className={ledger.select}
              value={prefer}
              disabled={busy}
              onChange={(event) => {
                setPrefer(event.target.value as Prefer)
                invalidatePreview()
              }}
            >
              <option value="">Newest wins</option>
              <option value="local">Keep destination</option>
              <option value="remote">Use source</option>
            </select>
          </SettingsRow>
        )}

        <SettingsRow
          label={withKeys ? 'Data + API keys' : 'Data only'}
          help={
            canImportKeys
              ? withKeys
                ? 'Copies stored key hashes too.'
                : 'Keeps this server\'s keys unchanged.'
              : `Missing the ${Claims.KeysImport} claim.`
          }
          inline
        >
          <Toggle
            on={withKeys}
            disabled={!canImportKeys || busy}
            onChange={(value) => {
              setWithKeys(value)
              invalidatePreview()
            }}
          />
        </SettingsRow>

        {withKeys && mode === 'replace' && (
          <SettingsAlert title="This browser's key will change">
            Destination API keys will be replaced by the source keys. This browser switches to the
            source key once the copy completes.
          </SettingsAlert>
        )}

        {error && (
          <SettingsAlert tone="bad" title="Copy failed">
            {error}
          </SettingsAlert>
        )}

        {busy && !result && (
          <div className={ledger.status}>
            <RefreshCw size={14} className="spin" /> {preview ? 'Copying…' : 'Reading and comparing source…'}
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
          {applied ? (
            <span className={`${ledger.sectionNote} ${ledger.noteOk}`}>
              <Check size={12} /> Copy completed in <b>{applied.mode}</b> mode.
            </span>
          ) : preview ? (
            <>
              <span className={ledger.sectionNote}>
                <Pill tone="warn" dot>
                  Preview — no changes written
                </Pill>
              </span>
              <Button variant="secondary" onClick={invalidatePreview} disabled={busy}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => copy(false)} disabled={busy}>
                {busy ? <RefreshCw size={14} className="spin" /> : <Check size={14} />} Apply copy
              </Button>
            </>
          ) : (
            <>
              <span className={ledger.sectionNote}>Runs a dry run first — nothing is written</span>
              <Button
                variant="primary"
                onClick={() => copy(true)}
                disabled={busy || !sourceUrl.trim() || !sourceApiKey.trim()}
              >
                {busy ? <RefreshCw size={14} className="spin" /> : <Copy size={14} />} Preview copy
              </Button>
            </>
          )}
        </div>
      </SettingsSection>
    </>
  )
}
