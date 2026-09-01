import { useEffect, useMemo, useRef, useState } from 'react'
import { CornerDownLeft, FileText, Image, Search, TriangleAlert } from 'lucide-react'
import { Claims } from '@silo/shared/claims'
import { api } from '../../api/silo-api'
import type { MediaAsset } from '../../api/types/media-asset'
import type { ScopeRef } from '../../api/types/scope-ref'
import type { SearchHit } from '../../api/types/search-hit'
import type { SearchReach } from '../../api/types/search-reach'
import type { SearchSnippet } from '../../api/types/search-snippet'
import { router } from '../../router/router'
import { PaletteResults, type PaletteItem } from './palette-results'
import { SnippetView } from './snippet-view'
import { ScopeMatcher } from './scope-match'
import { ScopeSuggest } from './ScopeSuggest'
import { MentionToken, type ActiveMention } from './mention-token'
import { CollectionVisits } from '../../utils/collection-visits'
import { SearchMemory } from './search-memory'
import styles from './SmartSearch.module.css'

const DEBOUNCE_MS = 200
const ENTRY_LIMIT = 20
const MEDIA_LIMIT = 6

/**
 * The top chrome search bar: searches across all collections in the active
 * scope by default, or narrows to a specific collection when the user scopes
 * it with an `@`-mention.
 *
 * Full-text search results render in an in-place dropdown directly extending
 * beneath the search bar, with keyboard navigation and snippet highlights.
 */
export function SmartSearch({
  serverId,
  url,
  apiKey,
  scope,
  claims,
  collections,
}: {
  serverId: string
  url: string
  apiKey: string
  scope: ScopeRef
  claims: string[]
  collections: readonly { name: string; count: number | null; schema?: any }[]
}) {
  const saved = useMemo(
    () => SearchMemory.get(serverId, scope.project, scope.env),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [serverId, scope.project, scope.env],
  )

  const [text, setText] = useState(saved?.text ?? '')
  const [query, setQuery] = useState(saved?.text?.trim() ?? '')
  const [chip, setChip] = useState<string | null>(saved?.chip ?? null)
  const [mention, setMention] = useState<ActiveMention | null>(null)
  const [highlightedMention, setHighlightedMention] = useState(0)
  const [hits, setHits] = useState<SearchHit[]>(saved?.hits ?? [])
  const [assets, setAssets] = useState<MediaAsset[]>(saved?.assets ?? [])
  const [engine, setEngine] = useState<'fts5' | 'scan' | null>(saved?.engine ?? null)
  const [truncated, setTruncated] = useState(saved?.truncated ?? false)
  const [error, setError] = useState(saved?.error ?? '')
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(0)
  const [focused, setFocused] = useState(false)
  const [isOpen, setIsOpen] = useState(false)

  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const seq = useRef(0)

  const canReadMedia = Claims.has(claims, Claims.MediaRead)

  const groups = useMemo(
    () => PaletteResults.build(hits, assets, { serverId, scope }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hits, assets, serverId, scope.project, scope.env],
  )
  const items = useMemo(() => PaletteResults.flatten(groups), [groups])

  // Dismiss dropdown / mention on click outside
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setIsOpen(false)
        setMention(null)
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [])

  // ⌘K / Ctrl-K and bare `/` focus the search bar from anywhere
  useEffect(() => {
    const typing = (el: EventTarget | null) => {
      const tag = (el as HTMLElement | null)?.tagName
      return tag === 'INPUT' || tag === 'TEXTAREA' || (el as HTMLElement | null)?.isContentEditable
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
        setIsOpen(true)
      } else if (e.key === '/' && !typing(e.target)) {
        e.preventDefault()
        inputRef.current?.focus()
        setIsOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    const t = setTimeout(() => setQuery(text.trim()), DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [text])

  const target: SearchReach = chip
    ? { kind: 'collection', scope, collection: chip }
    : { kind: 'scope', scope }

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

    const ticket = ++seq.current
    setLoading(true)
    Promise.all([
      api.search.run(url, apiKey, target, { query, limit: ENTRY_LIMIT }),
      canReadMedia && !chip
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
  }, [url, apiKey, query, chip, canReadMedia, scope.project, scope.env])

  const open = (item: PaletteItem) => {
    router.navigate(item.href)
    setIsOpen(false)
    setMention(null)
  }

  const recentOrder = useMemo(
    () => (scope ? CollectionVisits.recent(serverId, scope.project, scope.env) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [serverId, scope.project, scope.env],
  )
  const matchCount = mention ? ScopeMatcher.rank(mention.query, collections, recentOrder).length : 0

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value
    setText(next)
    setIsOpen(true)
    const at = MentionToken.at(next, e.target.selectionStart ?? next.length)
    setMention(at)
    setHighlightedMention(0)
  }

  const commitMention = (name: string) => {
    if (!mention) return
    const rest = MentionToken.consume(text, mention)
    setMention(null)
    setChip(name)
    setText(rest)
    inputRef.current?.focus()
  }

  const removeChip = () => {
    setChip(null)
    inputRef.current?.focus()
  }

  useEffect(() => {
    const nextSaved = SearchMemory.get(serverId, scope.project, scope.env)
    setText(nextSaved?.text ?? '')
    setQuery(nextSaved?.text?.trim() ?? '')
    setChip(nextSaved?.chip ?? null)
    setHits(nextSaved?.hits ?? [])
    setAssets(nextSaved?.assets ?? [])
    setEngine(nextSaved?.engine ?? null)
    setTruncated(nextSaved?.truncated ?? false)
    setError(nextSaved?.error ?? '')
    setMention(null)
    setIsOpen(false)
  }, [serverId, scope.project, scope.env])

  useEffect(() => {
    SearchMemory.set(serverId, scope.project, scope.env, {
      text,
      chip,
      hits,
      assets,
      engine,
      truncated,
      error,
    })
  }, [serverId, scope.project, scope.env, text, chip, hits, assets, engine, truncated, error])

  const clear = () => {
    setText('')
    setQuery('')
    setHits([])
    setAssets([])
    setEngine(null)
    setTruncated(false)
    setError('')
    setIsOpen(false)
    SearchMemory.clear(serverId, scope.project, scope.env)
    inputRef.current?.focus()
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (mention) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHighlightedMention((h) => (matchCount === 0 ? 0 : (h + 1) % matchCount))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHighlightedMention((h) => (matchCount === 0 ? 0 : (h - 1 + matchCount) % matchCount))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const matches = ScopeMatcher.rank(mention.query, collections, recentOrder)
        const picked = matches[highlightedMention]
        if (picked) {
          commitMention(picked.name)
        } else {
          setMention(null)
        }
      } else if (e.key === 'Escape') {
        e.preventDefault()
        setMention(null)
      }
      return
    }

    if (e.key === 'Backspace' && text === '' && chip !== null) {
      e.preventDefault()
      removeChip()
      return
    }

    if (e.key === 'Escape') {
      e.preventDefault()
      setIsOpen(false)
      inputRef.current?.blur()
      return
    }

    if (isOpen && items.length > 0) {
      if (e.key === 'ArrowDown' || (e.key === 'n' && e.ctrlKey)) {
        e.preventDefault()
        setActive((at) => (items.length === 0 ? 0 : (at + 1) % items.length))
      } else if (e.key === 'ArrowUp' || (e.key === 'p' && e.ctrlKey)) {
        e.preventDefault()
        setActive((at) => (items.length === 0 ? 0 : (at - 1 + items.length) % items.length))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const item = items[active]
        if (item) open(item)
      }
    }
  }

  // Keep the highlighted row in view when the arrow keys walk past the edge
  useEffect(() => {
    listRef.current?.querySelector(`[data-active="true"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const activeInput = text.trim() !== ''
  const placeholder = chip ? `Search in ${chip}…` : 'Search collections, entries, media…'

  let index = -1

  return (
    <div ref={wrapRef} className={`${styles.wrap} ${focused ? styles.focused : ''}`}>
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
        ref={inputRef}
        value={text}
        placeholder={placeholder}
        onChange={onChange}
        onKeyDown={onKeyDown}
        onFocus={() => {
          setFocused(true)
          setIsOpen(true)
        }}
        onBlur={() => setFocused(false)}
        aria-label="Search"
      />
      {engine && <span className={styles.engineTag}>{engine}</span>}
      {activeInput ? (
        <button type="button" className={styles.clear} onClick={clear} aria-label="Clear search">
          ×
        </button>
      ) : (
        <span className={styles.keycap}>⌘K</span>
      )}

      {mention ? (
        <ScopeSuggest
          query={mention.query}
          collections={collections}
          recentOrder={recentOrder}
          highlighted={highlightedMention}
          onHighlight={setHighlightedMention}
          onCommit={commitMention}
        />
      ) : (
        isOpen && query && (
          <div className={styles.dropdown}>
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
              {loading && items.length === 0 && (
                <div className={styles.loading}>Searching…</div>
              )}
              {!loading && items.length === 0 && !error && (
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
                        type="button"
                        className={`${styles.item} ${at === active ? styles.active : ''}`}
                        data-active={at === active}
                        onMouseMove={() => setActive(at)}
                        onClick={() => open(item)}
                      >
                        <span className={styles.itemMain}>
                          <span className={styles.itemTitle}>{item.title}</span>
                          <span className={styles.itemSubtitle}>{item.subtitle}</span>
                        </span>
                        {item.snippets.length > 0 && <Snippet snippet={item.snippets[0]} />}
                        {at === active && <CornerDownLeft size={13} className={styles.enterHint} />}
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        )
      )}
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

