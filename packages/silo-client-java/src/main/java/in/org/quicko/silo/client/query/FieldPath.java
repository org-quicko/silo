package in.org.quicko.silo.client.query;

/**
 * Builds the JSONPath strings the filter and sort AST address. A name may
 * already carry a bracket segment ({@code tags[0]}, {@code tags[-1]}) or a dot
 * for a nested field ({@code author.name}) — both pass through untouched, since
 * prefixing is plain concatenation.
 */
public final class FieldPath {
  private FieldPath() {}

  /** {@code field("title")} is {@code $.data.title}. */
  public static String field(String name) {
    return "$.data." + name;
  }

  /** {@code each("tags")} is {@code $.data.tags[*]}, so nobody types the wildcard. */
  public static String each(String name) {
    return "$.data." + name + "[*]";
  }

  /** {@code meta("updated_at")} addresses the envelope, not the data: {@code $.updated_at}. */
  public static String meta(String name) {
    return "$." + name;
  }
}
