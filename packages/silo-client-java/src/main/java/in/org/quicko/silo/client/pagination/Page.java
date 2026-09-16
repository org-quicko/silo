package in.org.quicko.silo.client.pagination;

import java.util.Iterator;
import java.util.List;
import java.util.Optional;
import java.util.OptionalInt;

/**
 * The shared shape of one page of results: the rows, the answered window and the
 * total. It loads nothing — a concrete page declares its own {@code next()} and
 * {@code previous()} returning its own type.
 *
 * <p>{@link #truncated()} marks a page whose {@code total} counts what a scan
 * examined rather than what exists. {@link #pageCount()} is then unknowable and
 * {@link #hasMore()} falls back to "this page came back full".
 */
public abstract class Page<Row> implements Iterable<Row> {
  private final List<Row> rows;
  private final PageWindow window;
  private final int total;
  private final boolean truncated;

  protected Page(List<Row> rows, int total, PageWindow window) {
    this(rows, total, window, false);
  }

  protected Page(List<Row> rows, int total, PageWindow window, boolean truncated) {
    this.rows = List.copyOf(rows);
    this.total = total;
    this.window = window;
    this.truncated = truncated;
  }

  /** How many rows match, across every page. */
  public int total() {
    return total;
  }

  public boolean truncated() {
    return truncated;
  }

  public int limit() {
    return window.limit();
  }

  public int offset() {
    return window.offset();
  }

  public int pageNumber() {
    return Math.floorDiv(offset(), limit()) + 1;
  }

  /** Empty when the total is a scan's count rather than a real one. */
  public OptionalInt pageCount() {
    if (truncated) return OptionalInt.empty();
    return OptionalInt.of(Math.max(1, (int) Math.ceil((double) total / limit())));
  }

  public boolean hasMore() {
    if (truncated) return rows.size() == limit();
    return offset() + rows.size() < total;
  }

  public boolean isEmpty() {
    return rows.isEmpty();
  }

  public int size() {
    return rows.size();
  }

  protected List<Row> rows() {
    return rows;
  }

  protected PageWindow window() {
    return window;
  }

  /** The window the next page would load, so no subclass repeats the
   *  "only if there is more" arithmetic. */
  protected Optional<PageWindow> windowForNext() {
    return hasMore() ? Optional.of(window.next()) : Optional.empty();
  }

  @Override
  public Iterator<Row> iterator() {
    return rows.iterator();
  }
}
