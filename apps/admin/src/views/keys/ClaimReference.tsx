import { useState } from 'react'
import { AlertTriangle, BookOpen, Plus, Search } from 'lucide-react'
import { Sheet } from '../../components/modal/Sheet'
import { ClaimReferenceEntries } from './claim-reference-entries'
import styles from './KeyForm.module.css'

interface Props {
  /** Adds a literal claim to the editor. Templates cannot be inserted: their
   *  segments are the part only the author knows. */
  onInsert: (claim: string) => void
  onClose: () => void
}

/** Every claim silo knows, and what holding it permits. */
export function ClaimReference({ onInsert, onClose }: Props) {
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()

  const sections = ClaimReferenceEntries.build()
    .map((section) => ({
      ...section,
      entries: section.entries.filter(
        (entry) =>
          !needle ||
          entry.spelling.toLowerCase().includes(needle) ||
          entry.meaning.toLowerCase().includes(needle),
      ),
    }))
    .filter((section) => section.entries.length > 0)

  return (
    <Sheet
      title="Claim reference"
      subtitle="Claims are denied by default. A key holds exactly what it is given."
      icon={<BookOpen size={18} />}
      width="lg"
      onClose={onClose}
    >
      <div className={styles.referenceSearch}>
        <Search size={14} />
        <input
          autoFocus
          value={query}
          placeholder="Search claims"
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {sections.map((section) => (
        <section className={styles.referenceSection} key={section.title}>
          <h4>{section.title}</h4>
          <p>{section.note}</p>
          <div className={styles.referenceRows}>
            {section.entries.map((entry) => (
              <div
                className={`${styles.referenceRow} ${entry.warn ? styles.referenceWarn : ''}`}
                key={entry.spelling}
              >
                <code>{entry.spelling}</code>
                <span>
                  {entry.warn && <AlertTriangle size={12} />}
                  {entry.meaning}
                </span>
                {entry.literal && (
                  <button type="button" title="Add to the editor" onClick={() => onInsert(entry.spelling)}>
                    <Plus size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}

      {sections.length === 0 && <p className={styles.wildNote}>No claim matches that.</p>}
    </Sheet>
  )
}
