package in.org.quicko.silo.client.entries;

import in.org.quicko.silo.client.query.FilterExpression;
import in.org.quicko.silo.client.query.SortTerm;

/**
 * Everything {@code collection.list()} accepts, all optional. Build one from
 * {@link #all()}: every method answers a new query rather than mutating this one.
 *
 * <p>{@code limit} and {@code offset} are boxed because "not asked for" and
 * "asked for zero" are different requests — silo clamps a non-positive limit to
 * 50, so sending a 0 nobody chose would be a silently different page.
 */
public record EntryListQuery(FilterExpression where, String sort, Integer limit, Integer offset) {
  private static final EntryListQuery All = new EntryListQuery(null, null, null, null);

  /** No filter, no sort, and whatever window the server defaults to. */
  public static EntryListQuery all() {
    return All;
  }

  public EntryListQuery where(FilterExpression value) {
    return new EntryListQuery(value, sort, limit, offset);
  }

  public EntryListQuery sort(SortTerm value) {
    return new EntryListQuery(where, value == null ? null : value.toString(), limit, offset);
  }

  public EntryListQuery sort(String value) {
    return new EntryListQuery(where, value, limit, offset);
  }

  public EntryListQuery limit(int value) {
    return new EntryListQuery(where, sort, value, offset);
  }

  public EntryListQuery offset(int value) {
    return new EntryListQuery(where, sort, limit, value);
  }

  /** The window this query asks for, used only when the server echoes none. */
  public int limitOrDefault() {
    return limit == null ? 50 : limit;
  }

  public int offsetOrDefault() {
    return offset == null ? 0 : offset;
  }
}
