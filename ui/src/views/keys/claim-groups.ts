import { Claims } from '@silo/shared/claims'
import type { CollectionPermission } from '@silo/shared/collection-permission'

export interface ClaimGroup {
  /** `acme / prod · all collections`, `Media`, … */
  title: string
  /** What the key may do there, in the reader's words. */
  lines: string[]
  /** Set when the group contains something destructive or escalating. */
  warn?: boolean
}

/**
 * Renders a claim set as the handful of sentences it actually means.
 *
 * A flat wall of `collections:acme/prod/posts:entries:update` strings is
 * technically complete and practically unreadable — the reason to show a
 * summary before minting a credential is that someone can catch a mistake in
 * it, and nobody proofreads forty monospace strings. The raw list is still one
 * disclosure away for anyone who wants to check the exact grammar.
 */
export class ClaimGroups {
  private static readonly permissionWords: Record<CollectionPermission, string> = {
    [Claims.CollectionSchemaRead]: 'read schema',
    [Claims.CollectionEntriesRead]: 'read entries',
    [Claims.CollectionEntriesCreate]: 'create entries',
    [Claims.CollectionEntriesUpdate]: 'update entries',
    [Claims.CollectionEntriesDelete]: 'delete entries',
    [Claims.CollectionCreate]: 'create collections',
    [Claims.CollectionSchemaUpdate]: 'edit schemas',
    [Claims.CollectionAccessUpdate]: 'change public access',
    [Claims.CollectionDelete]: 'delete collections',
  }

  /** Widest-first, so a summary reads like the role ladder rather than alphabetically. */
  private static readonly permissionOrder: CollectionPermission[] = [
    Claims.CollectionSchemaRead,
    Claims.CollectionEntriesRead,
    Claims.CollectionEntriesCreate,
    Claims.CollectionEntriesUpdate,
    Claims.CollectionEntriesDelete,
    Claims.CollectionCreate,
    Claims.CollectionSchemaUpdate,
    Claims.CollectionAccessUpdate,
    Claims.CollectionDelete,
  ]

  private static readonly destructive = new Set<string>([
    Claims.CollectionDelete,
    Claims.CollectionEntriesDelete,
    Claims.CollectionAccessUpdate,
    Claims.KeysRevoke,
    Claims.KeysExport,
    Claims.KeysImport,
    Claims.MediaDelete,
    Claims.TransferImport,
    Claims.TransferCopy,
  ])

  /**
   * Keyed in reading order, not alphabetically — `Claims.normalize` sorts the
   * claim strings, which would otherwise make media read "upload · delete ·
   * list". Insertion order here is the order the lines come out.
   */
  private static readonly fixedWords: Record<string, string> = {
    [Claims.MediaRead]: 'list media',
    [Claims.MediaCreate]: 'upload media',
    [Claims.MediaDelete]: 'delete media',
    [Claims.KeysRead]: 'list keys',
    [Claims.KeysCreate]: 'mint keys',
    [Claims.KeysRevoke]: 'revoke keys',
    [Claims.KeysExport]: 'export key hashes',
    [Claims.KeysImport]: 'import key hashes',
    [Claims.TransferExport]: 'export the instance',
    [Claims.TransferImport]: 'import into the instance',
    [Claims.TransferCopy]: 'copy from another server',
  }

  private static readonly fixedGroups: { title: string; prefix: string }[] = [
    { title: 'Media', prefix: 'media:' },
    { title: 'API keys', prefix: 'keys:' },
    { title: 'Data transfer', prefix: 'transfer:' },
  ]

  private static segment(value: string, plural: string): string {
    return value === Claims.Root ? plural : value
  }

  static build(claims: readonly string[]): ClaimGroup[] {
    if (claims.includes(Claims.Root)) {
      return [{
        title: 'Everything',
        lines: ['Full access to every project, environment, collection and key on this instance.'],
        warn: true,
      }]
    }

    const byTarget = new Map<string, CollectionPermission[]>()
    for (const claim of claims) {
      let parsed
      try {
        parsed = Claims.parse(claim)
      } catch {
        continue
      }
      if (parsed.kind !== 'collection' || !parsed.permission) continue
      const scope = `${ClaimGroups.segment(parsed.project!, 'every project')} / ${ClaimGroups.segment(parsed.env!, 'every environment')}`
      const target = `${scope} · ${parsed.name === Claims.Root ? 'all collections' : parsed.name}`
      const held = byTarget.get(target) ?? []
      held.push(parsed.permission)
      byTarget.set(target, held)
    }

    const groups: ClaimGroup[] = []
    for (const [title, permissions] of byTarget) {
      groups.push({
        title,
        lines: ClaimGroups.permissionOrder
          .filter((permission) => permissions.includes(permission))
          .map((permission) => ClaimGroups.permissionWords[permission]),
        warn: permissions.some((permission) => ClaimGroups.destructive.has(permission)),
      })
    }

    const catalogue = Object.keys(ClaimGroups.fixedWords)
    for (const { title, prefix } of ClaimGroups.fixedGroups) {
      const held = catalogue.filter((claim) => claim.startsWith(prefix) && claims.includes(claim))
      if (held.length === 0) continue
      groups.push({
        title,
        lines: held.map((claim) => ClaimGroups.fixedWords[claim]),
        warn: held.some((claim) => ClaimGroups.destructive.has(claim)),
      })
    }

    return groups
  }
}
