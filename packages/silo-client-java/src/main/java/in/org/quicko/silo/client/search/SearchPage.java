package in.org.quicko.silo.client.search;

import in.org.quicko.silo.client.pagination.Page;
import in.org.quicko.silo.client.pagination.PageWindow;
import java.util.List;
import java.util.Optional;
import java.util.function.Function;

/**
 * One page of search results.
 *
 * <p>On a truncated page the portable engine stopped at its visit cap, so
 * {@code total} counts what was examined rather than what exists:
 * {@link #pageCount()} is then empty and {@link #hasMore()} falls back to "this
 * page came back full". The base class already does both; this adds
 * {@link #hits()} and {@link #engine()}.
 */
public final class SearchPage extends Page<SearchHit> {
  private final SearchEngine engine;
  private final Function<PageWindow, SearchPage> loader;

  public SearchPage(
      List<SearchHit> rows,
      int total,
      PageWindow window,
      boolean truncated,
      SearchEngine engine,
      Function<PageWindow, SearchPage> loader) {
    super(rows, total, window, truncated);
    this.engine = engine;
    this.loader = loader;
  }

  public List<SearchHit> hits() {
    return rows();
  }

  /** Which engine answered, which is what decides whether a page can truncate. */
  public SearchEngine engine() {
    return engine;
  }

  public Optional<SearchPage> next() {
    return windowForNext().map(loader);
  }

  public Optional<SearchPage> previous() {
    return window().previous().map(loader);
  }
}
