package in.org.quicko.silo.client.entries;

import in.org.quicko.silo.client.pagination.Page;
import in.org.quicko.silo.client.pagination.PageWindow;
import java.util.List;
import java.util.Optional;
import java.util.function.Function;

/**
 * One page of entries, navigated by the window the server echoed rather than the
 * one requested.
 */
public final class EntryPage<F> extends Page<Entry<F>> {
  private final Function<PageWindow, EntryPage<F>> loader;

  public EntryPage(
      List<Entry<F>> rows, int total, PageWindow window, Function<PageWindow, EntryPage<F>> loader) {
    super(rows, total, window);
    this.loader = loader;
  }

  public List<Entry<F>> entries() {
    return rows();
  }

  public Optional<EntryPage<F>> next() {
    return windowForNext().map(loader);
  }

  public Optional<EntryPage<F>> previous() {
    return window().previous().map(loader);
  }
}
