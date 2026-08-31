import { ValidationError } from "@silo/shared/validation-error";

/**
 * Which filenames the library takes in (D46).
 *
 * An allowlist rather than a blocklist, for the reason every upload allowlist
 * is one: the set of dangerous extensions is open and grows with whatever the
 * browsers and the operating systems do next, while the set a media library
 * actually needs is short and known.
 *
 * The check is on the **extension**, not the declared content type. A
 * multipart part carries whatever `Content-Type` the client chose to put in
 * it, so trusting it would mean the caller decides whether the caller is
 * allowed; the extension at least decides what the file is served back as,
 * since `MimeUtils.lookup` reads exactly that.
 */
export class MediaExtensions {
  /** The escape hatch, and deliberately an ugly one: it is the whole check. */
  static readonly Any = "*";

  /** A filename's extension, lower case and without the dot. `""` when it has
   *  none, which is a value the check refuses rather than one it ignores. */
  static of(filename: string): string {
    const base = filename.split(/[/\\]/).pop() || "";
    const dot = base.lastIndexOf(".");
    return dot <= 0 ? "" : base.slice(dot + 1).toLowerCase();
  }

  static allows(allowed: readonly string[], filename: string): boolean {
    if (allowed.includes(MediaExtensions.Any)) return true;
    const extension = MediaExtensions.of(filename);
    return extension.length > 0 && allowed.includes(extension);
  }

  /**
   * The same question as a guard, with the answer in the message.
   *
   * It names what was refused and what is accepted, because the alternative is
   * an operator reading their own config file to find out why a PNG did not
   * upload — and the list is not a secret, it is on the settings page.
   */
  static assert(allowed: readonly string[], filename: string): void {
    if (MediaExtensions.allows(allowed, filename)) return;

    const extension = MediaExtensions.of(filename);
    const what = extension ? `".${extension}" files` : "files with no extension";
    throw new ValidationError(
      `${what} are not accepted. This library takes: ${[...allowed].sort().join(", ")}.`
    );
  }
}
