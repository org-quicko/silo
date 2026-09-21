package in.org.quicko.silo.client.search;

import in.org.quicko.silo.client.query.FilterExpression;
import in.org.quicko.silo.client.query.SortTerm;

/**
 * Everything a search accepts, all optional. Build one from {@link #matching}
 * or {@link #empty()}; omitting the sort ranks by relevance instead.
 */
public record SearchQuery(String text, FilterExpression where, String sort, Integer limit, Integer offset) {
  private static final SearchQuery Empty = new SearchQuery(null, null, null, null, null);

  /** A filter-only search: legal, and answers everything the key can read. */
  public static SearchQuery empty() {
    return Empty;
  }

  /** The words to look for, which the wire carries as {@code q}. Named
   *  {@code matching} because a static and an instance method with one
   *  {@code String} cannot share a name. */
  public static SearchQuery matching(String text) {
    return new SearchQuery(text, null, null, null, null);
  }

  public SearchQuery text(String value) {
    return new SearchQuery(value, where, sort, limit, offset);
  }

  public SearchQuery where(FilterExpression value) {
    return new SearchQuery(text, value, sort, limit, offset);
  }

  public SearchQuery sort(SortTerm value) {
    return new SearchQuery(text, where, value == null ? null : value.toString(), limit, offset);
  }

  public SearchQuery sort(String value) {
    return new SearchQuery(text, where, value, limit, offset);
  }

  public SearchQuery limit(int value) {
    return new SearchQuery(text, where, sort, value, offset);
  }

  public SearchQuery offset(int value) {
    return new SearchQuery(text, where, sort, limit, value);
  }

  public int limitOrDefault() {
    return limit == null ? 50 : limit;
  }

  public int offsetOrDefault() {
    return offset == null ? 0 : offset;
  }
}
