import type { MediaAsset } from '../../api/types/media-asset'
import type { ScopeRef } from '../../api/types/scope-ref'
import type { SearchHit } from '../../api/types/search-hit'
import type { SearchSnippet } from '../../api/types/search-snippet'
import { Routes } from '../../router/routes'
import { Formatters } from '../../utils/formatters'
import { ValueTitle } from '../../utils/value-title'
import type { ScopeMatch } from './scope-match'

export interface PaletteItem {
  id: string
  kind: 'collection' | 'entry' | 'media'
  title: string
  subtitle: string
  snippets: SearchSnippet[]
  href: string
}

export interface PaletteGroup {
  key: string
  label: string
  /** `project/env` when the group lies outside the scope on screen, else null. */
  scope: string | null
  kind: 'collection' | 'entry' | 'media'
  items: PaletteItem[]
}

/**
 * The bar's three result sets, arranged for reading.
 *
 * **Collections come first, and never from the server.** The bar promises to
 * search collections as well as their contents, and a collection is a name the
 * session already holds — asking an index for it would be a second request to
 * answer a question the sidebar's own list already answers. They lead because
 * they are navigation rather than content: a reader typing a collection's name
 * wants the collection, and there are at most a handful of them.
 *
 * **Media is a separate group, and only here.** The server keeps it out of the
 * entry index on purpose (D30): it is instance-global with its own `media:*`
 * claims, and folding it in would put two authorization models in one query.
 * Merging them is a presentation decision, so it is made in the presentation
 * layer and nowhere else.
 *
 * Entry groups keep the order their first hit arrived in, so the collection
 * holding the best match is listed first — regrouping alphabetically would
 * throw away the ranking that the search just did.
 */
export class PaletteResults {
  /**
   * Collections are cheap to match and would otherwise push the entry hits —
   * the thing a search is usually for — under the fold.
   */
  private static readonly CollectionLimit = 5

  /**
   * `collections` is last although it reads first: it is the newest of the
   * three result sets and every other caller passes none.
   */
  static build(
    hits: readonly SearchHit[],
    assets: readonly MediaAsset[],
    ctx: { serverId: string; scope: ScopeRef },
    collections: readonly ScopeMatch[] = [],
  ): PaletteGroup[] {
    const leading: PaletteGroup[] = []
    if (collections.length > 0) {
      leading.push({
        key: 'collections',
        label: 'Collections',
        scope: null,
        kind: 'collection',
        items: collections.slice(0, PaletteResults.CollectionLimit).map((match) => ({
          id: `collection:${ctx.scope.project}/${ctx.scope.env}/${match.name}`,
          kind: 'collection' as const,
          title: match.name,
          // A collection that matched on one of its *fields* says which, since
          // its own name does not explain why it is on screen.
          subtitle: match.matchedField
            ? `field: ${match.matchedField}`
            : match.count != null
              ? `${match.count} ${match.count === 1 ? 'entry' : 'entries'}`
              : 'Collection',
          snippets: [],
          href: Routes.entries(ctx.serverId, ctx.scope.project, ctx.scope.env, match.name),
        })),
      })
    }

    const groups = new Map<string, PaletteGroup>()

    for (const hit of hits) {
      const key = `${hit.project}/${hit.env}/${hit.collection}`
      let group = groups.get(key)
      if (!group) {
        const elsewhere = hit.project !== ctx.scope.project || hit.env !== ctx.scope.env
        group = {
          key,
          label: hit.collection,
          // Named only when it differs from the scope on screen: repeating the
          // current one on every row says nothing and hides the ones that do.
          scope: elsewhere ? `${hit.project}/${hit.env}` : null,
          kind: 'entry',
          items: [],
        }
        groups.set(key, group)
      }
      group.items.push({
        id: `entry:${key}/${hit.entry.id}`,
        kind: 'entry',
        title: ValueTitle.of(null, null, hit.entry.data) ?? Formatters.shortId(hit.entry.id),
        subtitle: Formatters.shortId(hit.entry.id),
        snippets: hit.snippets,
        href: Routes.entry(ctx.serverId, hit.project, hit.env, hit.collection, hit.entry.id),
      })
    }

    const result = [...leading, ...groups.values()]
    if (assets.length > 0) {
      result.push({
        key: 'media',
        label: 'Media',
        scope: null,
        kind: 'media',
        items: assets.map((asset) => ({
          id: `media:${asset.id}`,
          kind: 'media' as const,
          title: asset.filename,
          subtitle: asset.folder || '/',
          snippets: [],
          // The library has no per-asset URL, so the link carries the search
          // that found it — landing on a library of everything would make the
          // reader hunt for what they had already found.
          href: Routes.media(ctx.serverId, ctx.scope.project, ctx.scope.env, asset.filename),
        })),
      })
    }
    return result
  }

  /** The groups as one keyboard-navigable list, in the order they read. */
  static flatten(groups: readonly PaletteGroup[]): PaletteItem[] {
    return groups.flatMap((g) => g.items)
  }
}
