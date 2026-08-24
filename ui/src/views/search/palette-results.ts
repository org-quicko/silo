import type { MediaAsset } from '../../api/types/media-asset'
import type { ScopeRef } from '../../api/types/scope-ref'
import type { SearchHit } from '../../api/types/search-hit'
import type { SearchSnippet } from '../../api/types/search-snippet'
import { Routes } from '../../router/routes'
import { Formatters } from '../../utils/formatters'
import { ValueTitle } from '../../utils/value-title'

export interface PaletteItem {
  id: string
  kind: 'entry' | 'media'
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
  kind: 'entry' | 'media'
  items: PaletteItem[]
}

/**
 * The palette's two result sets, arranged for reading.
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
  static build(
    hits: readonly SearchHit[],
    assets: readonly MediaAsset[],
    ctx: { serverId: string; scope: ScopeRef },
  ): PaletteGroup[] {
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

    const result = [...groups.values()]
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
