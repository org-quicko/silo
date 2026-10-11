/**
 * What a collection may be called (D104): a lowercase letter, then lowercase
 * letters, digits, `-` and `_`, at most 128 characters in all.
 *
 * Longer than a project or environment id (64): a collection often carries a
 * prefix and a type name, as an import from another CMS writes them. 128
 * keeps well inside what the fs adapter needs, whose longest file for a
 * collection is its name plus 17 characters within a 255-byte component.
 *
 * The claim grammar builds its collection segment from {@link Segment}, so a
 * name that is valid here can always be named in a claim.
 */
export class CollectionName {
  static readonly MaxLength = 128;

  /** The rule as a regular expression fragment, without anchors. */
  static readonly Segment = `[a-z][a-z0-9_-]{0,${CollectionName.MaxLength - 1}}`;

  private static readonly Pattern = new RegExp(`^${CollectionName.Segment}$`);

  static isValid(name: string): boolean {
    return CollectionName.Pattern.test(name);
  }

  /**
   * Why `name` cannot name a collection, as a phrase an editor can act on,
   * or null when it can. It never repeats the name: the caller has it, and a
   * long one would fill the message.
   */
  static problem(name: string): string | null {
    if (name.length === 0) return "the name is empty";
    if (name.length > CollectionName.MaxLength) {
      return `the name has ${name.length} characters, and the most is ${CollectionName.MaxLength}`;
    }
    if (!/^[a-z]/.test(name)) return "the name must start with a lowercase letter";
    if (!CollectionName.Pattern.test(name)) {
      return 'the name can only have lowercase letters, digits, "-" and "_"';
    }
    return null;
  }
}
