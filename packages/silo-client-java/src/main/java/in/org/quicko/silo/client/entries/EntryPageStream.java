package in.org.quicko.silo.client.entries;

import in.org.quicko.silo.client.RequestOptions;
import in.org.quicko.silo.client.errors.RequestAbortedException;
import java.util.Iterator;
import java.util.NoSuchElementException;
import java.util.Optional;
import java.util.function.Supplier;

/**
 * What {@code collection.pages()} answers: whole pages, one at a time, advancing
 * by each page's own echoed window and stopping on the first short or empty one
 * — the same termination rule {@link in.org.quicko.silo.client.pagination.RowStream}
 * uses, applied one level up.
 */
public final class EntryPageStream<F> implements Iterable<EntryPage<F>> {
  private final Supplier<EntryPage<F>> first;
  private final RequestOptions options;

  public EntryPageStream(Supplier<EntryPage<F>> first, RequestOptions options) {
    this.first = first;
    this.options = options == null ? RequestOptions.none() : options;
  }

  @Override
  public Iterator<EntryPage<F>> iterator() {
    return new PageIterator();
  }

  private final class PageIterator implements Iterator<EntryPage<F>> {
    private EntryPage<F> pending;
    private boolean started;
    private boolean exhausted;

    @Override
    public boolean hasNext() {
      if (!started) {
        if (options.isCancelled()) throw new RequestAbortedException("GET", "stream");
        pending = first.get();
        started = true;
      }
      return !exhausted && pending != null;
    }

    @Override
    public EntryPage<F> next() {
      if (!hasNext()) throw new NoSuchElementException();
      EntryPage<F> page = pending;

      boolean lastPage = page.isEmpty() || page.size() < page.limit();
      if (lastPage) {
        exhausted = true;
        pending = null;
      } else {
        if (options.isCancelled()) throw new RequestAbortedException("GET", "stream");
        Optional<EntryPage<F>> following = page.next();
        pending = following.orElse(null);
        if (pending == null) exhausted = true;
      }
      return page;
    }
  }
}
