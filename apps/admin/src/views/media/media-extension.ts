/**
 * A filename's extension, lower case and without the dot, matching the rule
 * the server enforces (`MediaExtensions.of`).
 *
 * Here only to *describe* — what the Replace dialog filters its file picker
 * to, and what it says the replacement has to be (D67). The refusal itself is
 * the server's, so this never decides anything; it exists so the dialog's
 * promise and the server's answer are derived the same way rather than one of
 * them guessing.
 */
export class MediaExtension {
  /** `""` when the name has none, which is a value the server refuses rather
   *  than one it ignores. */
  static of(filename: string): string {
    const base = filename.split(/[/\\]/).pop() || ''
    const dot = base.lastIndexOf('.')
    return dot <= 0 ? '' : base.slice(dot + 1).toLowerCase()
  }
}
