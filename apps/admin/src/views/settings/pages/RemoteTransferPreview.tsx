import { AlertTriangle } from 'lucide-react'
import { Button } from '../../../components/buttons/Button'
import { StatTile } from '../../../components/data/StatTile'
import type { TransferPlanItem } from '../../../api/types/transfer-plan-item'
import { useRemoteTransfer } from './use-remote-transfer'
import styles from './EnvTransferPage.module.css'

/** Entries only: a deleted row is this server's, and media lines are not entries. */
const inspectable = (item: TransferPlanItem) => !!item.id && item.action !== 'deleted' && !item.collection.startsWith('_')

/** The plan this server saved for a transfer: its totals, its media, and one page of its lines. */
export function RemoteTransferPreview({ remote }: { remote: ReturnType<typeof useRemoteTransfer> }) {
  const transfer = remote.transfer
  const review = transfer?.review
  if (!transfer || !review) return null
  const applied = transfer.state === 'applied'
  const page = transfer.entries
  const media = review.media

  return <>
    <div className={styles.previewStats}>
      <StatTile n={review.added} label={applied ? 'Created' : 'Create'} tone="ok" prefix="+" />
      <StatTile n={review.updated} label={applied ? 'Updated' : 'Update'} tone="warn" prefix="~" />
      <StatTile n={review.deleted} label={applied ? 'Deleted' : 'Delete'} tone="bad" />
      <StatTile n={review.skipped} label="Skipped" tone="muted" />
      {review.rejected > 0 && <StatTile n={review.rejected} label="Rejected" tone="bad" />}
    </div>
    {transfer.media === 'referenced' && <p className={styles.previewSummary}>
      Media files: {media.added} {applied ? 'added' : 'to add'} · {media.unchanged} already here · {media.skipped} skipped
      {media.folders_added > 0 && ` · Folders: ${media.folders_added} ${applied ? 'added' : 'to add'}`}
    </p>}
    {media.unresolved.length > 0 && <div className="banner banner-warn"><AlertTriangle size={15} /><span>{media.unresolved.length} media references will not resolve here.</span></div>}
    {page && <details className={styles.previewDetails}>
      <summary>Collection and entry changes</summary>
      <div className={styles.previewCollections}>{review.collections.map((collection) => <div key={collection.collection}><b>{collection.collection}</b><span>Schema: {collection.schema}</span><span>Create {collection.added} · Update {collection.updated} · Delete {collection.deleted} · Skip {collection.skipped}</span></div>)}</div>
      <div className={styles.previewEntries}>{page.items.map((item, index) => <button key={`${item.collection}/${item.action}/${item.id || 'hidden'}/${index}`} type="button" onClick={() => remote.inspect(item.collection, item.id!)} disabled={!inspectable(item) || remote.busy}>
        <b>{item.action}</b> {item.collection} {item.id ? <code>{item.name ?? item.id}</code> : <span>destination id hidden</span>}
        {item.reason && <span>{item.reason}</span>}
        {!!item.unresolved?.length && <span>{item.unresolved.length} missing media</span>}
      </button>)}</div>
      {remote.inspected && <div className={styles.payloadPanel}><div><b>Entry to write</b><code>{remote.inspected.id}</code><Button variant="secondary" onClick={remote.clearInspected}>Close</Button></div><pre className={styles.payload}>{JSON.stringify(remote.inspected.data, null, 2)}</pre></div>}
      {page.total > page.limit && <div className={styles.previewPaging}><Button variant="secondary" onClick={() => remote.page(Math.max(0, page.offset - page.limit))} disabled={remote.busy || page.offset === 0}>Previous</Button><span>{page.offset + 1}–{Math.min(page.offset + page.items.length, page.total)} of {page.total}</span><Button variant="secondary" onClick={() => remote.page(page.offset + page.limit)} disabled={remote.busy || page.offset + page.limit >= page.total}>Next</Button></div>}
    </details>}
  </>
}
