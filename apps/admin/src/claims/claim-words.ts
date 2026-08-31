import { Claims } from '@silo/shared/claims'
import { HookNames } from '@silo/shared/hook-names'
import type { CollectionPermission } from '@silo/shared/collection-permission'
import type { HookName } from '@silo/shared/hook-name'

/**
 * Every claim silo has, in the words a person reads it in.
 *
 * A table rather than a `switch` so the gap between the vocabulary and the copy
 * is visible: a claim added to `ClaimVocabulary` and not added here renders as
 * its raw string under "Also" instead of vanishing, which is the failure this
 * whole summary exists to avoid.
 */
export class ClaimWords {
  static readonly permissions: Record<CollectionPermission, string> = {
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

  /** Widest-first, so a summary reads like the role ladder rather than
   *  alphabetically. */
  static readonly permissionOrder: readonly CollectionPermission[] = [
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

  /**
   * What being *delivered* a hook lets a plugin do (D34).
   *
   * Written as the power rather than the event, because the event name is the
   * thing a reader cannot weigh: "entry.beforeValidate" sounds smaller than
   * `entries:update` and is strictly larger — it rewrites every value written to
   * the collection, including values written by keys the plugin has no
   * permission over at all.
   */
  static readonly hooks: Record<HookName, string> = {
    'entry.beforeValidate': 'rewrite entries before they are validated',
    'entry.beforeWrite': 'reject writes',
    'entry.afterWrite': 'see every entry written',
    'entry.beforeDelete': 'reject deletes',
    'entry.afterDelete': 'see every entry deleted',
    'collection.afterDelete': 'see every collection erased, and how much it held',
  }

  /** Intervening hooks first — the ones that can change or stop a write, which
   *  is what a grant screen has to lead with. Derived from `HookNames` rather
   *  than listed, so a sixth hook cannot be added and silently sorted last. */
  static readonly hookOrder: readonly HookName[] = [
    ...HookNames.Intervening,
    ...HookNames.All.filter((hook) => !HookNames.isIntervening(hook)),
  ]

  /**
   * Keyed in reading order, not alphabetically — `Claims.normalize` sorts the
   * claim strings, which would otherwise make media read "upload · delete ·
   * list". Insertion order here is the order the lines come out.
   */
  static readonly fixed: Record<string, string> = {
    [Claims.MediaRead]: 'list media',
    [Claims.MediaCreate]: 'upload media',
    [Claims.MediaDelete]: 'delete media',
    [Claims.MediaConfigure]: 'change how the media library is set up',
    [Claims.SettingsConfigure]: 'change the server config file',
    [Claims.KeysRead]: 'list keys',
    [Claims.KeysCreate]: 'mint keys',
    [Claims.KeysRevoke]: 'revoke keys',
    [Claims.KeysExport]: 'export key hashes',
    [Claims.KeysImport]: 'import key hashes',
    [Claims.TransferExport]: 'export the instance',
    [Claims.TransferImport]: 'import into the instance',
    [Claims.TransferCopy]: 'copy from another server',
    [Claims.PluginsRead]: 'list plugins and their grants',
    [Claims.PluginsConfigure]: 'configure plugins',
    [Claims.PluginsGrant]: 'approve what a plugin may do',
    [Claims.PluginsEnable]: 'turn plugins on and off',
    [Claims.AuditRead]: 'read the authority trail',
    [Claims.HttpRoute]: 'serve its own HTTP routes',
  }

  /** Groups holding one of these are flagged for a second look. */
  static readonly destructive: ReadonlySet<string> = new Set<string>([
    Claims.CollectionDelete,
    Claims.CollectionEntriesDelete,
    Claims.CollectionAccessUpdate,
    Claims.KeysRevoke,
    Claims.KeysExport,
    Claims.KeysImport,
    Claims.MediaDelete,
    Claims.MediaConfigure,
    Claims.SettingsConfigure,
    Claims.TransferImport,
    Claims.TransferCopy,
  ])

  /** The fixed claims that have words here, in the order they were written. */
  static catalogue(): string[] {
    return Object.keys(ClaimWords.fixed)
  }

  /**
   * Section headings for the claim families, for the ones worth renaming.
   *
   * A lookup rather than the section list itself, because the *list* is derived
   * — see `families`. Only families whose prefix reads badly as a heading need
   * an entry here.
   */
  private static readonly familyTitles: Record<string, string> = {
    'keys:': 'API keys',
    'transfer:': 'Data transfer',
    'http:': 'HTTP',
  }

  /**
   * The claim families present in a catalogue, in catalogue order.
   *
   * **Derived, not listed**, and that is the point. A hand-maintained section
   * list is how `http:route` first rendered: `ClaimWords.fixed` named it, the
   * per-claim lookup spoke it, and the summary still printed it raw under "Also"
   * because no section matched its prefix. D40 fixed the version of this that
   * *dropped* a claim and left the version that merely fails to describe one, so
   * the rule is the same one restated: the question has to be answerable for a
   * claim family nobody has thought of yet.
   */
  static families(catalogue: readonly string[]): string[] {
    const seen: string[] = []
    for (const claim of catalogue) {
      const prefix = claim.slice(0, claim.indexOf(':') + 1)
      if (prefix.length > 0 && !seen.includes(prefix)) seen.push(prefix)
    }
    return seen
  }

  /** `"media:"` → `"Media"`, unless it reads badly and `familyTitles` says
   *  otherwise. */
  static familyTitle(prefix: string): string {
    const named = ClaimWords.familyTitles[prefix]
    if (named) return named
    const bare = prefix.replace(/:$/, '')
    return bare.charAt(0).toUpperCase() + bare.slice(1)
  }

  /**
   * One claim, in words — for a list that shows claims individually rather
   * than grouped by target.
   *
   * `null` when nothing here names it, so the caller can print the raw string
   * instead of an empty cell. Same rule as the summary: a claim with no words
   * for it is shown, never dropped.
   */
  static phrase(claim: string): string | null {
    if (claim === Claims.Root) return 'everything, everywhere'
    let parsed
    try {
      parsed = Claims.parse(claim)
    } catch {
      return null
    }
    if (parsed.kind === 'fixed') return ClaimWords.fixed[claim] ?? null
    if (parsed.kind === 'collection') return ClaimWords.permissions[parsed.permission!] ?? null
    if (parsed.kind === 'hook') return ClaimWords.hooks[parsed.hook!] ?? null
    return null
  }
}
