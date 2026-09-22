import type { SessionInfo } from '../../api/types/session-info'

/**
 * What a delete dialog promises (D91).
 *
 * The answer is an instance setting, so it comes off the session rather than
 * being assumed: a dialog that offers a restore on an instance running with
 * `[trash] enabled = false` is worse than one that offers nothing. A server too
 * old to say reads as permanent, which is what it is.
 */
export class TrashCopy {
  static enabled(session: SessionInfo | null): boolean {
    return session?.trash?.enabled === true
  }

  /** "You can restore it for 30 days." or "This cannot be undone." */
  static reassurance(session: SessionInfo | null): string {
    if (!TrashCopy.enabled(session)) return 'This cannot be undone.'
    const days = session?.trash?.retention_days ?? 0
    return days > 0
      ? `It goes to the trash, where you can restore it for ${days} days.`
      : 'It goes to the trash, where you can restore it.'
  }

  /** The verb the confirm button should use. */
  static verb(session: SessionInfo | null): string {
    return TrashCopy.enabled(session) ? 'Move to trash' : 'Delete'
  }
}
