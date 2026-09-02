/** What one key press on the entries list means. */
export type EntriesAction =
  | 'next-row'
  | 'previous-row'
  | 'first-row'
  | 'last-row'
  | 'next-page'
  | 'previous-page'
  | 'open'
  | 'delete'
  | 'new'
  | 'filter'
  | 'columns'
  | 'dismiss'

/** The part of a `KeyboardEvent` the rule reads, so it is testable without one. */
export interface KeyPress {
  key: string
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
}

/**
 * The entries list's keyboard map.
 *
 * `Enter` is deliberately absent: the focused row is a button and activates
 * itself, so binding it here as well would open the entry twice. `?` is absent
 * for the same class of reason — the shortcut list it opens covers the whole
 * app, so the shell owns that key. Paging is on the horizontal arrows rather
 * than PageUp/PageDown, which stay with the browser: a list this long still
 * needs to scroll.
 */
export class EntriesShortcuts {
  private static readonly Actions: Record<string, EntriesAction> = {
    arrowdown: 'next-row',
    j: 'next-row',
    arrowup: 'previous-row',
    k: 'previous-row',
    home: 'first-row',
    end: 'last-row',
    arrowleft: 'previous-page',
    h: 'previous-page',
    arrowright: 'next-page',
    l: 'next-page',
    e: 'open',
    backspace: 'delete',
    delete: 'delete',
    n: 'new',
    f: 'filter',
    c: 'columns',
    escape: 'dismiss',
  }

  /**
   * `null` when the press is not one of ours. A modified press never is — ⌘K,
   * Ctrl+R and Alt+F belong to the search bar, the browser and the sidebar — and
   * neither is anything typed into a field, where every letter is content and
   * the field owns its own Escape.
   */
  static actionFor(press: KeyPress, typing: boolean): EntriesAction | null {
    if (typing || press.ctrlKey || press.metaKey || press.altKey) return null
    return EntriesShortcuts.Actions[press.key.toLowerCase()] ?? null
  }
}
