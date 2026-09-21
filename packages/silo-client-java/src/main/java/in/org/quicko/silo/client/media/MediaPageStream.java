package in.org.quicko.silo.client.media;

import in.org.quicko.silo.client.RequestOptions;
import in.org.quicko.silo.client.errors.RequestAbortedException;
import java.util.Iterator;
import java.util.NoSuchElementException;
import java.util.function.Supplier;

/** What {@code media.pages()} answers: one whole page at a time, stopping once
 *  a page reports no more. */
public final class MediaPageStream implements Iterable<MediaPage> {
  private final Supplier<MediaPage> first;
  private final RequestOptions options;

  public MediaPageStream(Supplier<MediaPage> first, RequestOptions options) {
    this.first = first;
    this.options = options == null ? RequestOptions.none() : options;
  }

  @Override
  public Iterator<MediaPage> iterator() {
    return new PageIterator();
  }

  private final class PageIterator implements Iterator<MediaPage> {
    private MediaPage pending;
    private boolean started;

    @Override
    public boolean hasNext() {
      if (!started) {
        if (options.isCancelled()) throw new RequestAbortedException("GET", "stream");
        pending = first.get();
        started = true;
      }
      return pending != null;
    }

    @Override
    public MediaPage next() {
      if (!hasNext()) throw new NoSuchElementException();
      MediaPage page = pending;
      if (!page.hasMore()) {
        pending = null;
      } else {
        if (options.isCancelled()) throw new RequestAbortedException("GET", "stream");
        pending = page.next(options).orElse(null);
      }
      return page;
    }
  }
}
