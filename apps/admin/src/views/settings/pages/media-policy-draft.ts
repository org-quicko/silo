import type { MediaPolicyInput, MediaPolicyView } from '../../../api/types/media-settings'

/** The editable half of the `[media]` table. */
export interface MediaPolicyFields {
  base_url: string
  base_url_target: 'server' | 'store'
  extensions: string[]
}

/**
 * The rules the library form has to get right (D46), kept out of the component
 * so they can be read and tested without a DOM.
 *
 * `MediaStorageDraft`'s counterpart, and it seeds differently on purpose. That
 * form takes every value from the *file*, because the fs media path is derived
 * while nobody has named one and writing it back as a literal would break
 * `--data`. Nothing here is derived like that, and an empty extension list is
 * not a state the server will accept, so the list falls back to what is in
 * force: a box showing nothing while something is being enforced would be the
 * page lying in the other direction.
 */
export class MediaPolicyDraft {
  /** Accepts everything. The one value that turns the check off. */
  static readonly Any = '*'

  static of(view: MediaPolicyView): MediaPolicyFields {
    return {
      base_url: view.file.base_url ?? '',
      base_url_target: view.file.base_url_target ?? view.in_force.base_url_target,
      extensions: view.file.extensions ?? view.in_force.extensions,
    }
  }

  /** Whether anything differs from what the form was seeded with. */
  static changed(draft: MediaPolicyFields, view: MediaPolicyView): boolean {
    return JSON.stringify(draft) !== JSON.stringify(MediaPolicyDraft.of(view))
  }

  /** The body to save. Every field goes: an omitted one reads as cleared. */
  static payload(draft: MediaPolicyFields): MediaPolicyInput {
    return {
      base_url: draft.base_url.trim(),
      base_url_target: draft.base_url_target,
      extensions: draft.extensions,
    }
  }

  /**
   * One typed extension added to a list.
   *
   * Cleaned the way the server cleans it, so the chip a user sees is the value
   * that gets stored rather than one that quietly changes on save. A comma
   * splits, because pasting a list is the fastest way to fill this in.
   */
  static add(current: string[], typed: string): string[] {
    const next = [...current]
    for (const part of typed.split(',')) {
      const cleaned = part.trim().toLowerCase().replace(/^\.+/, '')
      if (cleaned && !next.includes(cleaned)) next.push(cleaned)
    }
    return next
  }

  static remove(current: string[], extension: string): string[] {
    return current.filter((each) => each !== extension)
  }

  /** Whether the list accepts everything, which the page says out loud rather
   *  than leaving as a `*` chip somebody has to recognise. */
  static acceptsEverything(extensions: string[]): boolean {
    return extensions.includes(MediaPolicyDraft.Any)
  }
}
