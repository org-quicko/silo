package in.org.quicko.silo.client.query;

/**
 * Builds the query AST so nobody types
 * {@code {"op":"eq","path":"$.data.status","value":"published"}} by hand.
 *
 * <p>The two spellings of a wildcard predicate mean different things, and saying
 * them out loud is the point: {@code each("tags").isNotEqualTo("x")} is
 * <em>some tag is not x</em>, while {@code not(each("tags").isEqualTo("x"))} is
 * <em>no tag is</em>.
 *
 * <p>There is no typed variant. The TypeScript client types a filter to
 * {@code keyof Fields}; Java has no equivalent of that, so a misspelled field
 * name is a runtime mismatch here rather than a compile error.
 */
public final class Filter {
  private Filter() {}

  /** A field of the entry's own data. */
  public static FilterField field(String name) {
    return new FilterField(FieldPath.field(name));
  }

  /** One element at a time of an array field. */
  public static FilterField each(String name) {
    return new FilterField(FieldPath.each(name));
  }

  /** A field of the envelope: {@code id}, {@code rev}, {@code created_at},
   *  {@code updated_at}. */
  public static FilterField meta(String name) {
    return new FilterField(FieldPath.meta(name));
  }

  public static FilterExpression and(FilterExpression left, FilterExpression right) {
    return left.and(right);
  }

  public static FilterExpression or(FilterExpression left, FilterExpression right) {
    return left.or(right);
  }

  public static FilterExpression not(FilterExpression expression) {
    return expression.not();
  }

  /** The escape hatch: wraps a hand-built node exactly as given. */
  public static FilterExpression raw(FilterNode node) {
    return new FilterExpression(node);
  }
}
