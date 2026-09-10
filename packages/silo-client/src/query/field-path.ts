/**
 * Builds the JSONPath strings the filter and sort AST address. A name may
 * already carry a bracket segment (`tags[0]`, `tags[-1]`) or a dot for a
 * nested field (`author.name`) — both pass through untouched, since prefixing
 * is plain string concatenation.
 */
export class FieldPath {
  /** `field("title")` is `$.data.title`. */
  static field(name: string): string {
    return `$.data.${name}`;
  }

  /** `each("tags")` is `$.data.tags[*]`, so nobody types the wildcard. */
  static each(name: string): string {
    return `$.data.${name}[*]`;
  }

  /** `meta("updated_at")` addresses the envelope, not `data`: `$.updated_at`. */
  static meta(name: string): string {
    return `$.${name}`;
  }
}
