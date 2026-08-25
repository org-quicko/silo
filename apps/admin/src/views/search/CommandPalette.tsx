import { useEffect, useMemo, useRef, useState } from 'react'
import { CornerDownLeft, FileText, Image, Search, TriangleAlert } from 'lucide-react'
import { Claims } from '@silo/shared/claims'
import { api } from '../../api/silo-api'
import type { MediaAsset } from '../../api/types/media-asset'
import type { ScopeRef } from '../../api/types/scope-ref'
import type { SearchHit } from '../../api/types/search-hit'
import type { SearchReach } from '../../api/types/search-reach'
import type { SearchSnippet } from '../../api/types/search-snippet'
import { PaletteResults, type PaletteItem } from './palette-results'
import { SnippetView } from './snippet-view'
import styles from './CommandPalette.module.css'

const DEBOUNCE_MS = 220
const ENTRY_LIMIT = 20
const MEDIA_LIMIT = 6

/**
 * Search, on `⌘K` or handed off from the smart bar's scope chip (D30, handoff
 * 1c "Instance").
 *
 * With no `reach`, it searches the whole instance rather than the scope on
 * screen, because the key already bounds it: `Service.searchAccess` compiles
 * the caller's `entries:read` claims into the set of collections that may be
 * reached, so asking for everything returns exactly what this key can see and
 * nothing needs to be narrowed here to be safe. A `reach` narrows it further
 * still — the smart bar hands one over when its scope chip named a collection
 * on a page that has nowhere to show in-table results (anywhere but Entries).
 */
export function CommandPalette({
  serverId,
  url,
  apiKey,
  scope,
  claims,
  initialQuery,
  reach,
  onNavigate,
  onClose,
}: {
  serverId: string
  url: string
  apiKey: string
  scope: ScopeRef
  claims: string[]
  /** Seeds the field when opened already carrying text, e.g. from the smart bar. */
  initialQuery?: string
  /** Narrows the search to one collection instead of the whole instance. */
  reach?: { collection: string }
  onNavigate: (href: string) => void
  onClose: () => void
}) {
  const [text, setText] = useState(initialQuery ?? '')
  const [query, setQuery] = useState(initialQuery?.trim() ?? '')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [assets, setAssets] = useState<MediaAsset[]>([])
  const [engine, setEngine] = useState<'fts5' | 'scan' | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const seq = useRef(0)

  const canReadMedia = Claims.has(claims, Claims.MediaRead)
  // Keyed on the scope's values for the same reason the entries view is: the
  // prop is a new object on every parent render, and memoising on its identity
  // memoises nothing.
  const groups = useMemo(
    () => PaletteResults.build(hits, assets, { serverId, scope }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hits, assets, serverId, scope.project, scope.env],
  )
  const items = useMemo(() => PaletteResults.flatten(groups), [groups])

  useEffect(() => {
    input.current?.focus()
  }, [])

  // Escape listens on the window, not on the palette: the arrow keys and Enter
  // only mean anything while the field has focus, but "let me out of here"
  // has to work wherever the focus happens to have gone — which is how every
  // other overlay in the shell behaves.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    const t = setTimeout(() => setQuery(text.trim()), DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [text])

  const target: SearchReach = reach ? { kind: 'collection', scope, collection: reach.collection } : { kind: 'instance' }

  useEffect(() => {
    setActive(0)
    if (!query) {
      setHits([])
      setAssets([])
      setEngine(null)
      setTruncated(false)
      setError('')
      return
    }
    // Ticketed, not cancelled: several requests are in flight while typing and
    // they can land out of order, so the last one asked for has to win.
    const ticket = ++seq.current
    setLoading(true)
    Promise.all([
      api.search.run(url, apiKey, target, { q: query, limit: ENTRY_LIMIT }),
      // Media is a second, independent search with its own claims — and it is
      // not "inside" any one collection, so a scoped hand-off skips it rather
      // than surfacing assets from outside the collection the chip named.
      canReadMedia && !reach
        ? api.media.list(url, apiKey, { q: query, limit: MEDIA_LIMIT }).catch(() => ({ items: [] as MediaAsset[] }))
        : Promise.resolve({ items: [] as MediaAsset[] }),
    ])
      .then(([page, media]) => {
        if (seq.current !== ticket) return
        setHits(page.items)
        setAssets(media.items)
        setEngine(page.engine)
        setTruncated(page.truncated)
        setError('')
      })
      .catch((e: unknown) => {
        if (seq.current !== ticket) return
        setHits([])
        setAssets([])
        setError(e instanceof Error ? e.message : 'Search failed')
      })
      .then(() => {
        if (seq.current === ticket) setLoading(false)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, apiKey, query, canReadMedia, reach?.collection])

  const open = (item: PaletteItem) => {
    onNavigate(item.href)
    onClose()
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown' || (event.key === 'n' && event.ctrlKey)) {
      event.preventDefault()
      setActive((at) => (items.length === 0 ? 0 : (at + 1) % items.length))
    } else if (event.key === 'ArrowUp' || (event.key === 'p' && event.ctrlKey)) {
      event.preventDefault()
      setActive((at) => (items.length === 0 ? 0 : (at - 1 + items.length) % items.length))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const item = items[active]
      if (item) open(item)
    }
  }

  // Keep the highlighted row in view when the arrow keys walk past the edge.
  useEffect(() => {
    listRef.current?.querySelector(`[data-active="true"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  let index = -1

  return (
    <div className={styles.backdrop} onMouseDown={onClose}>
      <div className={styles.palette} onMouseDown={(event) => event.stopPropagation()} onKeyDown={onKeyDown}>
        <div className={styles.field}>
          <Search size={16} />
          <input
            ref={input}
            value={text}
            placeholder={reach ? `Search ${reach.collection}…` : 'Search every collection you can read…'}
            onChange={(event) => setText(event.target.value)}
            aria-label="Search"
          />
          {engine && <span className={styles.engine}>{engine}</span>}
          <span className={styles.keycap}>esc</span>
        </div>

        {error && (
          <div className={styles.notice}>
            <TriangleAlert size={13} /> {error}
          </div>
        )}
        {truncated && !error && (
          <div className={styles.notice}>
            <TriangleAlert size={13} /> The scan stopped at its limit — there may be more.
          </div>
        )}

        <div className={styles.results} ref={listRef}>
          {!query && (
            <div className={styles.hint}>
              {reach
                ? `Type to search ${reach.collection}.`
                : `Type to search entries across every project and environment this key can read${canReadMedia ? ', and the media library' : ''}.`}
            </div>
          )}
          {query && !loading && items.length === 0 && !error && (
            <div className={styles.hint}>Nothing matches “{query}”.</div>
          )}

          {groups.map((group) => (
            <div key={group.key} className={styles.group}>
              <div className={styles.groupHead}>
                {group.kind === 'media' ? <Image size={12} /> : <FileText size={12} />}
                <span className={styles.groupLabel}>{group.label}</span>
                {group.scope && <span className={styles.groupScope}>{group.scope}</span>}
              </div>
              {group.items.map((item) => {
                index++
                const at = index
                return (
                  <button
                    key={item.id}
                    className={`${styles.item} ${at === active ? styles.active : ''}`}
                    data-active={at === active}
                    onMouseMove={() => setActive(at)}
                    onClick={() => open(item)}
                  >
                    <span className={styles.itemMain}>
                      <span className={styles.itemTitle}>{item.title}</span>
                      <span className={styles.itemSubtitle}>{item.subtitle}</span>
                    </span>
                    {item.snippets.length > 0 && (
                      <Snippet snippet={item.snippets[0]} />
                    )}
                    {at === active && <CornerDownLeft size={13} className={styles.enterHint} />}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function Snippet({ snippet }: { snippet: SearchSnippet }) {
  const s = SnippetView.clamp(snippet)
  return (
    <span className={styles.itemSnippet}>
      {s.before}
      <mark className={styles.match}>{s.match}</mark>
      {s.after}
    </span>
  )
}
