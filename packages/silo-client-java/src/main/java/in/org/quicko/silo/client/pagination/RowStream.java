package in.org.quicko.silo.client.pagination;

import in.org.quicko.silo.client.RequestOptions;
import in.org.quicko.silo.client.errors.RequestAbortedException;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.NoSuchElementException;
import java.util.Spliterator;
import java.util.Spliterators;
import java.util.stream.Stream;
import java.util.stream.StreamSupport;

/**
 * The shared auto-pager behind {@code collection.all()} and its siblings. Pages
 * lazily, advances by the window the server echoed rather than by what was asked
 * for, and stops on the first short or empty page.
 *
 * <p>Offset iteration over data being written concurrently is not a snapshot: an
 * entry created ahead of the cursor can be missed, and one deleted behind it can
 * shift a row into a page already yielded.
 */
public class RowStream<Row> implements Iterable<Row> {
  private final RowLoader<Row> loader;
  private final int startingLimit;
  private final RequestOptions options;

  public RowStream(RowLoader<Row> loader, int startingLimit, RequestOptions options) {
    this.loader = loader;
    this.startingLimit = startingLimit;
    this.options = options == null ? RequestOptions.none() : options;
  }

  @Override
  public Iterator<Row> iterator() {
    return new PagingIterator();
  }

  /** The same rows as a {@link Stream}, still paged lazily. */
  public Stream<Row> stream() {
    return StreamSupport.stream(
        Spliterators.spliteratorUnknownSize(iterator(), Spliterator.ORDERED | Spliterator.NONNULL),
        false);
  }

  /** Drains the whole stream, for a caller who knows the result set is small. */
  public List<Row> toList() {
    List<Row> all = new ArrayList<>();
    for (Row row : this) {
      all.add(row);
    }
    return List.copyOf(all);
  }

  private final class PagingIterator implements Iterator<Row> {
    private PageWindow window = new PageWindow(startingLimit, 0);
    private Iterator<Row> page = java.util.Collections.emptyIterator();
    private boolean exhausted;

    @Override
    public boolean hasNext() {
      while (!page.hasNext() && !exhausted) {
        advance();
      }
      return page.hasNext();
    }

    @Override
    public Row next() {
      if (!hasNext()) throw new NoSuchElementException();
      return page.next();
    }

    /** Loads the next page, and decides from its own window whether one follows. */
    private void advance() {
      if (options.isCancelled()) {
        throw new RequestAbortedException("GET", "stream");
      }
      RowBatch<Row> batch = loader.load(window);
      page = batch.rows().iterator();

      boolean lastPage = batch.rows().isEmpty() || batch.rows().size() < batch.window().limit();
      if (lastPage) {
        exhausted = true;
      } else {
        window = batch.window().next();
      }
    }
  }
}
