package in.org.quicko.silo.client;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import in.org.quicko.silo.client.pagination.Page;
import in.org.quicko.silo.client.pagination.PageWindow;
import in.org.quicko.silo.client.pagination.RowBatch;
import in.org.quicko.silo.client.pagination.RowStream;
import java.util.ArrayList;
import java.util.List;
import java.util.OptionalInt;
import org.junit.jupiter.api.Test;

class PaginationTest {

  @Test
  void advancesByTheWindowRatherThanByTheRequest() {
    PageWindow window = new PageWindow(500, 0);
    assertEquals(new PageWindow(500, 500), window.next());
  }

  @Test
  void hasNoPageBeforeTheStart() {
    assertTrue(new PageWindow(50, 0).previous().isEmpty());
    assertEquals(new PageWindow(50, 0), new PageWindow(50, 50).previous().orElseThrow());
  }

  @Test
  void countsPagesFromTheAnsweredWindow() {
    TestPage page = new TestPage(List.of(1, 2), 5, new PageWindow(2, 2), false);
    assertEquals(2, page.pageNumber());
    assertEquals(OptionalInt.of(3), page.pageCount());
    assertTrue(page.hasMore());
  }

  @Test
  void refusesToGuessAPageCountForATruncatedTotal() {
    TestPage page = new TestPage(List.of(1, 2), 2, new PageWindow(2, 0), true);
    assertEquals(OptionalInt.empty(), page.pageCount());
    assertTrue(page.hasMore(), "a full page is the only evidence a truncated scan leaves");

    TestPage shortPage = new TestPage(List.of(1), 1, new PageWindow(2, 0), true);
    assertFalse(shortPage.hasMore());
  }

  @Test
  void pagesLazilyAndStopsOnTheFirstShortPage() {
    List<PageWindow> asked = new ArrayList<>();
    RowStream<Integer> stream = new RowStream<>(window -> {
      asked.add(window);
      List<Integer> rows = window.offset() == 0 ? List.of(1, 2) : List.of(3);
      return new RowBatch<>(rows, window);
    }, 2, RequestOptions.none());

    assertEquals(List.of(1, 2, 3), stream.toList());
    assertEquals(List.of(new PageWindow(2, 0), new PageWindow(2, 2)), asked);
  }

  @Test
  void followsTheWindowTheServerAnsweredNotTheOneAskedFor() {
    List<PageWindow> asked = new ArrayList<>();
    RowStream<Integer> stream = new RowStream<>(window -> {
      asked.add(window);
      PageWindow clamped = new PageWindow(2, window.offset());
      List<Integer> rows = window.offset() == 0 ? List.of(1, 2) : List.of();
      return new RowBatch<>(rows, clamped);
    }, 900, RequestOptions.none());

    assertEquals(List.of(1, 2), stream.toList());
    assertEquals(
        List.of(new PageWindow(900, 0), new PageWindow(2, 2)),
        asked,
        "the second request steps by the 2 the server used, never by the 900 requested");
  }

  @Test
  void stopsBeforeTheNextRequestOnceTheCallerCancels() {
    CancellationSignal signal = CancellationSignal.create();
    RowStream<Integer> stream = new RowStream<>(window -> {
      signal.cancel();
      return new RowBatch<>(List.of(1, 2), window);
    }, 2, RequestOptions.until(signal));

    List<Integer> seen = new ArrayList<>();
    try {
      for (Integer row : stream) {
        seen.add(row);
      }
      throw new AssertionError("the stream should have refused to load a second page");
    } catch (in.org.quicko.silo.client.errors.RequestAbortedException expected) {
      assertEquals(List.of(1, 2), seen);
    }
  }

  /** The abstract base has no concrete subclass outside the client, so the
   *  arithmetic is exercised through one of its own. */
  private static final class TestPage extends Page<Integer> {
    TestPage(List<Integer> rows, int total, PageWindow window, boolean truncated) {
      super(rows, total, window, truncated);
    }
  }
}
