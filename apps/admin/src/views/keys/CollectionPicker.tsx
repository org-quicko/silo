import { ChevronDown, Search } from 'lucide-react'
import { useState } from 'react'
import styles from './NewKey.module.css'

interface Props {
  scopeLabel: string
  collections: string[]
  selected: string[]
  narrowed: boolean
  onNarrow: (narrowed: boolean) => void
  onToggle: (name: string) => void
}

/**
 * All collections, or a named few.
 *
 * Narrowing is the difference between a key that picks up collections created
 * later and one that does not, so both choices are spelled out rather than
 * being a checkbox.
 */
export function CollectionPicker({
  scopeLabel,
  collections,
  selected,
  narrowed,
  onNarrow,
  onToggle,
}: Props) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)

  const visible = collections.filter((name) => name.includes(query.trim().toLowerCase()))

  return (
    <div className="field">
      <label className="field-label">Collections</label>

      <div className={styles.scopeChoices}>
        <button
          type="button"
          className={`${styles.scopeChoice} ${!narrowed ? styles.scopeChoiceActive : ''}`}
          onClick={() => onNarrow(false)}
        >
          <b>All collections</b>
          <span>Every collection in {scopeLabel}, including ones created later</span>
        </button>
        <button
          type="button"
          className={`${styles.scopeChoice} ${narrowed ? styles.scopeChoiceActive : ''}`}
          onClick={() => onNarrow(true)}
        >
          <b>Selected collections</b>
          <span>New collections stay denied</span>
        </button>
      </div>

      {narrowed && (
        <div className={styles.collectionPicker}>
          <button
            type="button"
            className={styles.pickerTrigger}
            onClick={() => setOpen(!open)}
          >
            <span>{selected.length ? `${selected.length} selected` : 'Choose collections…'}</span>
            <ChevronDown size={15} />
          </button>

          {open && (
            <div className={styles.pickerPopover}>
              <div className={styles.collectionSearch}>
                <Search size={14} />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search collections"
                />
              </div>
              <div className={styles.collectionOptions}>
                {visible.map((name) => (
                  <label key={name}>
                    <input
                      type="checkbox"
                      checked={selected.includes(name)}
                      onChange={() => onToggle(name)}
                    />
                    <span>{name}</span>
                  </label>
                ))}
                {visible.length === 0 && <span className="muted">No collections found.</span>}
              </div>
            </div>
          )}

          {selected.length > 0 && (
            <div className={styles.selectedChips}>
              {selected.map((name) => (
                <button type="button" key={name} onClick={() => onToggle(name)}>
                  {name}
                  <span>×</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
