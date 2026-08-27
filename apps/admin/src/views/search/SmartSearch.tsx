import { useEffect, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { ScopeMatcher } from './scope-match'
import { ScopeSuggest } from './ScopeSuggest'
import { MentionToken, type ActiveMention } from './mention-token'
import type { PaletteSeed } from './palette-seed'
import { CollectionVisits } from '../../utils/collection-visits'
import type { ScopeRef } from '../../api/types/scope-ref'
import styles from './SmartSearch.module.css'

const DEBOUNCE_MS = 200

/** What only the Entries page provides: a live, in-table, collection-scoped search. */
export interface SmartSearchListQuery {
  q: string
  engine: 'fts5' | 'scan' | null
  onQueryChange: (q: string) => void
}

/**
 * The "one smart search field" the redesign collapses three fields into
 * (handoff 1a/1b/1c/1f): a rounded bar in the top chrome, carrying a scope
 * chip that narrows results to one collection, or — chip removed — widens to
 * the whole instance and hands off to the `CommandPalette` overlay.
 *
 * State here is deliberately all component-local except the one thing that
 * has to be linkable: the query text of an *in-table* search, which the
 * caller (`Entries`) owns and writes to the URL. Everything else — the chip,
 * the `@`-mention popup, the debounce timers — resets on navigation because
 * `collection` changing is exactly what navigation looks like from here.
 */
export function SmartSearch({
  serverId,
  scope,
  collection,
  collections,
  listQuery,
  onNavigateToCollection,
  onOpenPalette,
}: {
  serverId: string
  /** `null` on an unscoped settings page (API keys, connection…) — recency tracking is simply skipped there. */
  scope: ScopeRef | null
  /** The page's own collection context, if it has one — prefills the chip. */
  collection: string | null
  collections: readonly { name: string; count: number | null; schema?: any }[]
  /** Present only on the Entries page, where a scoped query replaces the table. */
  listQuery?: SmartSearchListQuery
  onNavigateToCollection: (name: string, q: string) => void
  onOpenPalette: (seed: PaletteSeed) => void
}) {
  const [text, setText] = useState(listQuery?.q ?? '')
  const [chip, setChip] = useState<string | null>(collection)
  const [mention, setMention] = useState<ActiveMention | null>(null)
  const [highlighted, setHighlighted] = useState(0)
  const [focused, setFocused] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  // What the URL already holds, for the same reason Entries used to track it
  // itself: it suppresses a redundant push and lets back/forward reset the box.
  const synced = useRef(listQuery?.q ?? '')
  // The instance overlay is opened once per typing session, not once per
  // keystroke — after it opens, focus moves into its own field and further
  // characters land there instead of re-seeding this one. Reset whenever the
  // bar is focused again, which is the signal that the overlay is behind us
  // and the next query is a new one.
  const handoff = useRef(false)
  // The settle timer fires up to `DEBOUNCE_MS` after the render that armed it,
  // and `onQueryChange` closes over the caller's whole `ListQuery`. Read
  // through a ref so a filter applied in that window is not reverted by a
  // callback still holding the query as it was when the user stopped typing.
  const latest = useRef(listQuery)
  latest.current = listQuery

  // Navigating resets the bar to whatever the page it landed on says: the
  // chip becomes that page's collection (or nothing), and the text becomes
  // that page's `?q=`, so a deep link still fills the box while walking away
  // from a searched list leaves an empty one. A same-page re-render never
  // fires this, so it does not fight a chip the user just popped by hand.
  useEffect(() => {
    const next = listQuery?.q ?? ''
    setChip(collection)
    setMention(null)
    setText(next)
    synced.current = next
    handoff.current = false
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collection])

  useEffect(() => {
    if (!listQuery) return
    if (listQuery.q === synced.current) return
    synced.current = listQuery.q
    setText(listQuery.q)
  }, [listQuery?.q])

  useEffect(() => {
    if (mention) return // still choosing a scope — nothing has "settled" yet
    if (chip !== null && chip === collection && latest.current) {
      if (text === synced.current) return
      const t = setTimeout(() => {
        synced.current = text
        latest.current?.onQueryChange(text)
      }, DEBOUNCE_MS)
      return () => clearTimeout(t)
    }
    if (text.trim() === '') {
      handoff.current = false
      return
    }
    if (handoff.current) return
    const t = setTimeout(() => {
      handoff.current = true
      onOpenPalette({ q: text.trim(), collection: chip })
    }, DEBOUNCE_MS)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, chip, mention])

  // ⌘K / Ctrl-K (a chord, safe to catch even from inside another field) and a
  // bare `/` (only when nothing else is capturing keystrokes) focus the bar
  // from anywhere on the page. Escape blurs it from anywhere too.
  useEffect(() => {
    const typing = (el: EventTarget | null) => {
      const tag = (el as HTMLElement | null)?.tagName
      return tag === 'INPUT' || tag === 'TEXTAREA' || (el as HTMLElement | null)?.isContentEditable
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        input.current?.focus()
        input.current?.select()
      } else if (e.key === '/' && !typing(e.target)) {
        e.preventDefault()
        input.current?.focus()
      } else if (e.key === 'Escape') {
        // Not reached while the mention popup is open — that Escape is handled
        // on the input and stops there, so dismissing the popup leaves the
        // caret where it was instead of throwing focus out of the field.
        input.current?.blur()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const recentOrder = useMemo(
    () => (scope ? CollectionVisits.recent(serverId, scope.project, scope.env) : []),
    [serverId, scope?.project, scope?.env],
  )
  const matchCount = mention ? ScopeMatcher.rank(mention.query, collections, recentOrder).length : 0

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value
    setText(next)
    const at = MentionToken.at(next, e.target.selectionStart ?? next.length)
    setMention(at)
    setHighlighted(0)
  }

  const commitMention = (name: string) => {
    if (!mention) return
    const rest = MentionToken.consume(text, mention)
    setMention(null)
    setChip(name)
    setText(rest)
    // Recording the visit is the shell's job (`Workspace`) — it fires for
    // every way a collection gets opened, not only this one.
    if (name !== collection) onNavigateToCollection(name, rest)
  }

  const removeChip = () => {
    setChip(null)
    handoff.current = false
    input.current?.focus()
  }

  const clear = () => {
    setText('')
    handoff.current = false
    if (chip !== null && chip === collection && listQuery) {
      synced.current = ''
      listQuery.onQueryChange('')
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (mention) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHighlighted((h) => (matchCount === 0 ? 0 : (h + 1) % matchCount))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHighlighted((h) => (matchCount === 0 ? 0 : (h - 1 + matchCount) % matchCount))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const matches = ScopeMatcher.rank(mention.query, collections, recentOrder)
        const picked = matches[highlighted]
        if (picked) commitMention(picked.name)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        // Kept off the window handler above, which would blur the field.
        e.stopPropagation()
        setMention(null) // the literal `@query` text stays put
      }
      return
    }
    if (e.key === 'Backspace' && text === '' && chip !== null) {
      e.preventDefault()
      removeChip()
    }
  }

  const active = text.trim() !== ''
  const placeholder = chip ? `Search entries in ${chip}…` : 'Search collections, entries, media, etc…'

  return (
    <div className={`${styles.wrap} ${focused ? styles.focused : ''}`}>
      <Search size={15} className={styles.icon} />
      {chip && (
        <span className={styles.chip} title={chip}>
          <span className={styles.chipName}>{chip}</span>
          <button type="button" className={styles.chipRemove} onClick={removeChip} aria-label={`Remove ${chip} scope`}>
            ×
          </button>
        </span>
      )}
      <input
        ref={input}
        value={text}
        placeholder={placeholder}
        onChange={onChange}
        onKeyDown={onKeyDown}
        onFocus={() => {
          setFocused(true)
          // Coming back to the bar ends the previous typing session, so the
          // next query may open the overlay again. Without this, a second
          // search after closing it would silently do nothing.
          handoff.current = false
        }}
        onBlur={() => setFocused(false)}
        aria-label="Search"
      />
      {active ? (
        <>
          {listQuery?.engine && chip === collection && <span className={styles.engineTag}>{listQuery.engine}</span>}
          <button type="button" className={styles.clear} onClick={clear} aria-label="Clear search">
            ×
          </button>
        </>
      ) : (
        <span className={styles.keycap}>⌘K</span>
      )}

      {mention && (
        <ScopeSuggest
          query={mention.query}
          collections={collections}
          recentOrder={recentOrder}
          highlighted={highlighted}
          onHighlight={setHighlighted}
          onCommit={commitMention}
        />
      )}
    </div>
  )
}
