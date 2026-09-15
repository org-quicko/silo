import { Check } from 'lucide-react'
import { Button } from '../../../components/buttons/Button'
import { StatTile } from '../../../components/data/StatTile'
import type { ScopeRef } from '../../../api/types/scope-ref'
import { useScopeCopy } from './use-scope-copy'
import styles from './EnvTransferPage.module.css'

/** Compact totals and the bounded, expandable detail for a copy preview. */
export function ScopeCopyPreview({ copy, destination }: { copy: ReturnType<typeof useScopeCopy>; destination: ScopeRef }) {
  if (!copy.result) return null
  return <>
    <div className={styles.previewStats}>
      <StatTile n={copy.result.added} label={copy.applied ? 'Created' : 'Create'} tone="ok" prefix="+" />
      <StatTile n={copy.result.updated} label={copy.applied ? 'Updated' : 'Update'} tone="warn" prefix="~" />
      <StatTile n={copy.result.deleted} label={copy.applied ? 'Deleted' : 'Delete'} tone="bad" />
      <StatTile n={copy.result.skipped} label="Skipped" tone="muted" />
    </div>
    {copy.preview?.scope_copy && <details className={styles.previewDetails}>
      <summary>Collection and entry changes</summary>
      <p className={styles.previewSummary}>{copy.preview.scope_copy.collections.length} collections · {copy.preview.scope_copy.collections.reduce((total, collection) => total + collection.added + collection.updated + collection.skipped, 0)} source entries · schemas included</p>
      <div className={styles.previewCollections}>{copy.preview.scope_copy.collections.map((collection) => <div key={collection.collection}><b>{collection.collection}</b><span>Schema: {collection.schema}</span><span>Create {collection.added} · Update {collection.updated} · Delete {collection.deleted} · Skip {collection.skipped}</span></div>)}</div>
      <div className={styles.previewEntries}>{copy.preview.scope_copy.entries.map((entry, index) => <button key={`${entry.collection}/${entry.action}/${entry.id || 'hidden'}/${index}`} type="button" onClick={() => entry.id && entry.action !== 'deleted' && copy.inspectEntry(entry.collection, entry.id)} disabled={!entry.id || entry.action === 'deleted'}><b>{entry.action}</b> {entry.collection} {entry.id ? <code>{entry.id}</code> : <span>destination id hidden</span>}</button>)}</div>
      {copy.inspected && <div className={styles.payloadPanel}><div><b>Source entry payload</b><code>{copy.inspected.id}</code><Button variant="secondary" onClick={copy.clearInspected}>Close</Button></div><pre className={styles.payload}>{JSON.stringify(copy.inspected.data, null, 2)}</pre></div>}
      {copy.preview.scope_copy.total > copy.preview.scope_copy.limit && <div className={styles.previewPaging}><Button variant="secondary" onClick={() => copy.run(true, Math.max(0, copy.preview!.scope_copy!.offset - copy.preview!.scope_copy!.limit))} disabled={copy.busy || copy.preview.scope_copy.offset === 0}>Previous</Button><span>{copy.preview.scope_copy.offset + 1}–{Math.min(copy.preview.scope_copy.offset + copy.preview.scope_copy.entries.length, copy.preview.scope_copy.total)} of {copy.preview.scope_copy.total}</span><Button variant="secondary" onClick={() => copy.run(true, copy.preview!.scope_copy!.offset + copy.preview!.scope_copy!.limit)} disabled={copy.busy || copy.preview.scope_copy.offset + copy.preview.scope_copy.limit >= copy.preview.scope_copy.total}>Next</Button></div>}
    </details>}
    {copy.applied && <div className="banner banner-ok"><Check size={15} /><span>Copied into {destination.env} in <b>{copy.applied.mode}</b> mode.</span></div>}
  </>
}
