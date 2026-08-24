import { useEffect, useRef } from 'react'
import { LetterAvatar } from '../../components/LetterAvatar'
import { ScopeMatcher } from './scope-match'
import styles from './ScopeSuggest.module.css'

/**
 * The `@`-mention popup (handoff 1f) — the only way to change the smart
 * bar's scope from inside it. `query` is whatever the user typed after `@`;
 * an empty query lists every collection the bar could scope to, most
 * recently visited first.
 */
export function ScopeSuggest({
  query,
  collections,
  recentOrder,
  highlighted,
  onHighlight,
  onCommit,
}: {
  query: string
  collections: readonly { name: string; count: number | null; schema?: any }[]
  recentOrder: readonly string[]
  highlighted: number
  onHighlight: (index: number) => void
  onCommit: (name: string) => void
}) {
  const matches = ScopeMatcher.rank(query, collections, recentOrder)
  const list = useRef<HTMLDivElement>(null)

  // Keep the highlighted row in view when the arrow keys walk past the edge —
  // the list scrolls at 260px and an instance can hold twenty collections.
  useEffect(() => {
    list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [highlighted])

  if (matches.length === 0) {
    return (
      <div className={styles.popup}>
        <p className={styles.empty}>
          No collection here named “{query}”. <kbd>⏎</kbd> searches the whole instance for the literal text; <kbd>esc</kbd> keeps
          typing.
        </p>
      </div>
    )
  }

  return (
    <div className={styles.popup}>
      <div className={styles.header}>
        <span>Scope to a collection</span>
        <span className={styles.total}>{collections.length}</span>
      </div>
      <div className={styles.list} ref={list}>
        {matches.map((m, i) => (
          <button
            key={m.name}
            type="button"
            className={`${styles.row} ${i === highlighted ? styles.active : ''}`}
            data-active={i === highlighted}
            // The input keeps focus, so the click must not blur it first —
            // blurring would settle the query and close the popup mid-click.
            onMouseDown={(e) => e.preventDefault()}
            onMouseMove={() => onHighlight(i)}
            onClick={() => onCommit(m.name)}
          >
            <LetterAvatar name={m.name} square />
            <span className={styles.rowMain}>
              <span className={styles.name}>{highlight(m.name, query)}</span>
              {m.matchedField && (
                <span className={styles.fieldMatch}>
                  {m.name} — {highlight(m.matchedField, query)}
                </span>
              )}
            </span>
            {m.count != null && <span className={styles.count}>{m.count}</span>}
            {i === highlighted && <kbd className={styles.enterKey}>⏎</kbd>}
          </button>
        ))}
      </div>
      <div className={styles.footer}>
        <kbd>↑↓</kbd> move · <kbd>⏎</kbd> scope · <kbd>esc</kbd> keep the @ as text
      </div>
    </div>
  )
}

/** Wraps the matched run so it reads like a search hit, not just a plain label. */
function highlight(text: string, query: string) {
  const q = query.trim()
  if (!q) return text
  const at = text.toLowerCase().indexOf(q.toLowerCase())
  if (at === -1) return text
  return (
    <>
      {text.slice(0, at)}
      <mark className={styles.match}>{text.slice(at, at + q.length)}</mark>
      {text.slice(at + q.length)}
    </>
  )
}
