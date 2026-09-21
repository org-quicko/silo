package in.org.quicko.silo.client.query;

/**
 * One sort key: a path plus a direction. Renders to what the {@code sort} query
 * parameter wants — the path alone when ascending, prefixed with {@code -} when
 * descending.
 */
public record SortTerm(String path, SortDirection direction) {

  public SortTerm(String path) {
    this(path, SortDirection.ASCENDING);
  }

  public SortTerm ascending() {
    return new SortTerm(path, SortDirection.ASCENDING);
  }

  public SortTerm descending() {
    return new SortTerm(path, SortDirection.DESCENDING);
  }

  @Override
  public String toString() {
    return direction == SortDirection.DESCENDING ? "-" + path : path;
  }
}
