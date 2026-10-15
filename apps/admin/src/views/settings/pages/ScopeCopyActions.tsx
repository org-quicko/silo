import { Check, Copy, RefreshCw } from 'lucide-react'
import { Button } from '../../../components/buttons/Button'
import type { ScopeRef } from '../../../api/types/scope-ref'
import { useScopeCopy } from './use-scope-copy'
import styles from './EnvTransferPage.module.css'
import { ScopeCopyPreview } from './ScopeCopyPreview'

/** Progress, the preview and Preview / Apply / Cancel for a copy within this server (D22). */
export function ScopeCopyActions({ copy, destination }: { copy: ReturnType<typeof useScopeCopy>; destination: ScopeRef }) {
  return (
    <>
      {copy.busy && (
        <div className={styles.progress}>
          <RefreshCw size={14} className="spin" />
          {copy.preview ? 'Copying…' : 'Comparing the two environments…'}
        </div>
      )}

      <ScopeCopyPreview copy={copy} destination={destination} />

      <div className={styles.actions}>
        <span className={styles.actionNote}>
          {copy.sourceEnvironments.length === 0
            ? `${copy.sourceProject} has no other environment to copy from.`
            : copy.preview
              ? 'The source is read again on apply, so live edits may shift these numbers slightly.'
              : 'Preview reads both environments and writes nothing.'}
        </span>
        <div className={styles.actionButtons}>
          {copy.preview && (
            <Button variant="secondary" onClick={() => copy.setMode(copy.mode)} disabled={copy.busy}>
              Cancel
            </Button>
          )}
          <Button
            variant="primary"
            onClick={() => copy.run(copy.preview === null)}
            disabled={copy.busy || !copy.from || !copy.allowed || !copy.selectionValid || copy.applied !== null}
          >
            {copy.busy ? <RefreshCw size={14} className="spin" /> : copy.preview ? <Check size={14} /> : <Copy size={14} />}
            {copy.busy ? 'Working…' : copy.preview ? 'Apply copy' : copy.applied ? 'Copy complete' : 'Preview copy'}
          </Button>
        </div>
      </div>
    </>
  )
}
