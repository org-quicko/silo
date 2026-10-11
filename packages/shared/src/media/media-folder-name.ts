/**
 * What a media folder may be called (D23, D105): each path segment starts with
 * a letter or digit and then uses letters, digits, spaces, `.`, `_` and `-`,
 * up to 64 characters, and a path goes at most 16 levels deep.
 *
 * The server refuses a path that breaks the rule; the admin asks the same
 * question before it uploads a folder, so a tree is refused whole and not
 * half-created.
 */
export class MediaFolderName {
  static readonly MaxDepth = 16;
  static readonly MaxSegment = 64;

  /** The rule in one line, for a message that follows a refusal. */
  static readonly Rule =
    'Folder names start with a letter or digit and use only letters, digits, spaces, ".", "_" and "-".';

  private static readonly Pattern = /^[a-zA-Z0-9][a-zA-Z0-9 ._-]*$/;

  /** Why `segment` cannot be one level of a folder path, or null when it can. */
  static segmentProblem(segment: string): string | null {
    if (segment === "." || segment === "..") return MediaFolderName.invalid(segment);
    if (segment.length > MediaFolderName.MaxSegment) {
      return `folder segment "${segment}" is longer than ${MediaFolderName.MaxSegment} characters`;
    }
    return MediaFolderName.Pattern.test(segment) ? null : MediaFolderName.invalid(segment);
  }

  /** Why a path of `depth` levels is too deep, or null when it is not. */
  static depthProblem(depth: number): string | null {
    return depth > MediaFolderName.MaxDepth
      ? `folder is deeper than ${MediaFolderName.MaxDepth} levels`
      : null;
  }

  private static invalid(segment: string): string {
    return `invalid folder segment "${segment}"`;
  }
}
