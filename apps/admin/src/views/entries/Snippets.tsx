import type { SearchSnippet } from '../../api/types/search-snippet'
import { SnippetView } from '../search/snippet-view'
import styles from './Entries.module.css'

/**
 * Why a row is in the results. The matched run arrives as its own field
 * (D30/§5.5) rather than marked up inside the text, so the highlight lands on
 * what the engine actually matched even when the surrounding prose is full of
 * brackets of its own.
 */
export function Snippets({ snippets }: { snippets?: SearchSnippet[] }) {
  if (!snippets || snippets.length === 0) return null
  return (
    <span className={styles.snippets}>
      {snippets.map((raw, i) => {
        const s = SnippetView.clamp(raw)
        return (
          <span key={`${s.path}:${i}`} className={styles.snippet}>
            <span className={styles.snippetPath}>{s.path}</span>
            <span className={styles.snippetText}>
              {s.before}
              <mark className={styles.snippetMatch}>{s.match}</mark>
              {s.after}
            </span>
          </span>
        )
      })}
    </span>
  )
}
