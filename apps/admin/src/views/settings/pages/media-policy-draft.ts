import type { MediaDownloadField, MediaPolicyInput, MediaPolicyView } from '../../../api/types/media-settings'

/** The editable half of the `[media]` table. A download ceiling is the box's
 *  text, and `''` means the default. */
export interface MediaPolicyFields {
  base_url: string
  extensions: string[]
  download_max_files: string
  download_max_size_mb: string
  download_max_streams: string
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

  static readonly DownloadFields: readonly MediaDownloadField[] = [
    'download_max_files',
    'download_max_size_mb',
    'download_max_streams',
  ]

  static of(view: MediaPolicyView): MediaPolicyFields {
    return {
      base_url: view.file.base_url ?? '',
      extensions: view.file.extensions ?? view.in_force.extensions,
      download_max_files: MediaPolicyDraft.text(view.file.download_max_files),
      download_max_size_mb: MediaPolicyDraft.text(view.file.download_max_size_mb),
      download_max_streams: MediaPolicyDraft.text(view.file.download_max_streams),
    }
  }

  /** Whether anything differs from what the form was seeded with. */
  static changed(draft: MediaPolicyFields, view: MediaPolicyView): boolean {
    return JSON.stringify(draft) !== JSON.stringify(MediaPolicyDraft.of(view))
  }

  /** The body to save. Every field goes: an omitted one reads as cleared, and
   *  an empty ceiling is sent as `null`, its default. */
  static payload(draft: MediaPolicyFields): MediaPolicyInput {
    const payload: MediaPolicyInput = {
      base_url: draft.base_url.trim(),
      extensions: draft.extensions,
    }
    for (const field of MediaPolicyDraft.DownloadFields) {
      const typed = draft[field].trim()
      payload[field] = typed === '' ? null : Number(typed)
    }
    return payload
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

  private static text(value: number | undefined): string {
    return value === undefined ? '' : String(value)
  }
}
