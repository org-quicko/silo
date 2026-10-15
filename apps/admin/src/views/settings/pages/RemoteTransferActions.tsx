import { AlertTriangle, Check, Copy, RefreshCw } from 'lucide-react'
import { Button } from '../../../components/buttons/Button'
import { useRemoteTransfer } from './use-remote-transfer'
import styles from './EnvTransferPage.module.css'

const Phases: Record<string, string> = {
  fetch: 'Fetching from the source…',
  verify: 'Checking the package…',
  plan: 'Comparing with this environment…',
  media: 'Writing media files…',
  commit: 'Writing the copy…',
}

const Redo = {
  stale: 'This environment changed since the preview.',
  expired: 'This preview expired.',
}

/** Progress, the outcome, and Preview / Apply / Cancel for a copy from another server. */
export function RemoteTransferActions({
  remote,
  ready,
  source,
  env,
}: {
  remote: ReturnType<typeof useRemoteTransfer>
  /** The form names something this key and the source key may copy. */
  ready: boolean
  source: string
  env: string
}) {
  const prepared = remote.transfer?.state === 'prepared' && !remote.redo
  const applied = remote.transfer?.state === 'applied'
  const run = remote.redo || !prepared ? remote.prepare : remote.apply

  return <>
    {remote.busy && remote.phase && <div className={styles.progress}><RefreshCw size={14} className="spin" />{Phases[remote.phase] ?? 'Working…'}</div>}
    {remote.redo && <div className="banner banner-warn"><AlertTriangle size={15} /><span>{Redo[remote.redo]}</span></div>}
    {applied && <div className="banner banner-ok"><Check size={15} /><span>Copied from {source} into {env}.</span></div>}
    <div className={styles.actions}>
      <span className={styles.actionNote}>
        {applied ? '' : prepared ? 'Apply writes exactly this preview, or nothing.' : 'Preview fetches the selection and writes nothing.'}
      </span>
      <div className={styles.actionButtons}>
        {remote.cancellable && <Button variant="secondary" onClick={remote.discard}>Cancel</Button>}
        <Button variant="primary" onClick={run} disabled={remote.busy || !ready || applied}>
          {remote.busy ? <RefreshCw size={14} className="spin" /> : prepared ? <Check size={14} /> : <Copy size={14} />}
          {remote.busy ? 'Working…' : remote.redo ? 'Preview again' : prepared ? 'Apply copy' : applied ? 'Copy complete' : 'Preview copy'}
        </Button>
      </div>
    </div>
  </>
}
