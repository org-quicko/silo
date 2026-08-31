import type { RenameFolderOutcome } from './use-media-library'

/**
 * The pure half of the rename-then-merge-offer flow: what a `renameFolder`
 * result means for what `useMediaRenameFolderFlow` shows next (D49).
 *
 * Kept apart from the hook that drives it, on the same reasoning
 * `MediaDeleteOutcome` already exists for — the decision is testable
 * without a DOM.
 */
export class MediaRenameOutcome {
  /** The merge offer to show, or `null` when none is needed: a `'conflict'`
   *  is the only outcome that earns one, since `'ok'` closes the flow and
   *  any other failure already landed in the library's own `error` banner. */
  static mergeOffer(
    outcome: RenameFolderOutcome,
    from: string,
    to: string,
  ): { from: string; to: string } | null {
    return outcome === 'conflict' ? { from, to } : null
  }

  /** Whether this outcome ends the flow — success, from either the plain
   *  rename or the merge retry. */
  static closes(outcome: RenameFolderOutcome): boolean {
    return outcome === 'ok'
  }
}
