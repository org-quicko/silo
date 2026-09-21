package in.org.quicko.silo.client.query;

import java.util.Arrays;
import java.util.stream.Collectors;

/**
 * Sort statics. There is no {@code each}, deliberately: a sort path must select
 * at most one node, so there is no wildcard variant to offer.
 */
public final class Sort {
  private Sort() {}

  public static SortTerm by(String name) {
    return new SortTerm(FieldPath.field(name));
  }

  public static SortTerm meta(String name) {
    return new SortTerm(FieldPath.meta(name));
  }

  /** Sorts on {@code updated_at}, most recent first. Named for the field rather
   *  than for a vague idea of recency — {@link #recentlyCreated()} is a
   *  different order, and one {@code newest()} hid which one it meant. */
  public static SortTerm recentlyUpdated() {
    return meta("updated_at").descending();
  }

  public static SortTerm recentlyCreated() {
    return meta("created_at").descending();
  }

  /** Joins terms with a comma, which is what the {@code sort} parameter wants. */
  public static String of(SortTerm... terms) {
    return Arrays.stream(terms).map(SortTerm::toString).collect(Collectors.joining(","));
  }
}
