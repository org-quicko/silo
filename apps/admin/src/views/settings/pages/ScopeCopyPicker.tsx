import { Search, X } from 'lucide-react'
import { Button } from '../../../components/buttons/Button'
import { useScopeCopy } from './use-scope-copy'
import styles from './EnvTransferPage.module.css'

/** Search and edit the explicit portion of a source scope to transfer. */
export function ScopeCopyPicker({ copy }: { copy: ReturnType<typeof useScopeCopy> }) {
  const query = copy.scopeSearch.query.trim().toLowerCase()
  const collections = copy.collections.filter((collection) => collection.name.includes(query)).slice(0, 5)

  return <div className={styles.selection}>
    <div className={styles.selectionHead}>Search source scope</div>
    <label className={styles.searchBox}>
      <Search size={15} />
      <input value={copy.scopeSearch.query} onChange={(event) => copy.setScopeQuery(event.target.value)} onKeyDown={(event) => {
        if (event.key === 'Escape') copy.setScopeQuery('')
        if (event.key === 'Enter' && query && !copy.scopeSearch.loading) {
          const entry = copy.scopeSearch.entries[0]
          if (entry) copy.addEntry(entry)
          else if (collections[0]) copy.addCollection(collections[0].name)
        }
      }} placeholder="Search collections or entries" aria-label="Search collections or entries" disabled={copy.busy} />
    </label>
    {!copy.scopeSearch.query && <span className={styles.empty}>Start typing to find a collection or entry in {copy.from?.project}/{copy.from?.env}.</span>}
    {!!copy.scopeSearch.query && <div className={styles.suggestions} aria-label="Source search results">
      {collections.map((collection) => {
        const included = copy.selection.some((item) => item.collection === collection.name && item.entryIds === undefined)
        return <div key={collection.id}><span><b>{collection.name}</b><small>Collection · {collection.entries} entries · schema</small></span><Button variant="secondary" onClick={() => copy.addCollection(collection.name)} disabled={copy.busy || included}>{included ? 'Included' : 'Add all'}</Button></div>
      })}
      {copy.scopeSearch.loading && <span className={styles.empty}>Searching source entries…</span>}
      {copy.scopeSearch.error && <span className={styles.empty}>{copy.scopeSearch.error}</span>}
      {copy.scopeSearch.entries.map((entry) => {
        const selected = copy.selection.find((item) => item.collection === entry.collection)
        const covered = !!selected && (selected.entryIds === undefined || selected.entryIds.includes(entry.id))
        return <div key={`${entry.collection}/${entry.id}`}><span><b>{typeof entry.data.title === 'string' ? entry.data.title : entry.id}</b><small>{entry.collection} · <code>{entry.id}</code></small></span><Button variant="secondary" onClick={() => copy.addEntry(entry)} disabled={copy.busy || covered}>{covered ? 'Included' : 'Add'}</Button></div>
      })}
      {!copy.scopeSearch.loading && copy.scopeSearch.entries.length === 0 && collections.length === 0 && <span className={styles.empty}>No matching collections or entries.</span>}
    </div>}
    <div className={styles.selectedTransfer}>
      <b>Selected for transfer</b>
      {copy.selection.length === 0 && <span className={styles.empty}>No items selected. Search above to add a collection or entry.</span>}
      {copy.selection.map((item) => item.entryIds === undefined
        ? <div key={item.collection}><span><b>{item.collection}</b><small>All {copy.collections.find((collection) => collection.name === item.collection)?.entries || 0} entries · schema</small></span><button type="button" onClick={() => copy.removeCollection(item.collection)} aria-label={`Remove ${item.collection}`} disabled={copy.busy}><X size={14} /></button></div>
        : item.entryIds.map((id) => { const entry = copy.selectedEntries[`${item.collection}/${id}`]; return <div key={`${item.collection}/${id}`}><span><b>{typeof entry?.data.title === 'string' ? entry.data.title : id}</b><small>{item.collection} · <code>{id}</code></small></span><button type="button" onClick={() => copy.removeEntry(item.collection, id)} aria-label={`Remove ${id}`} disabled={copy.busy}><X size={14} /></button></div> }))}
    </div>
  </div>
}
