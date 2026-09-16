package in.org.quicko.silo.client.pagination;

import java.util.Optional;

/**
 * The {@code limit} and {@code offset} a page answered — as the server clamped
 * them, not as they were asked for. Navigation is arithmetic on this window and
 * never on the request that produced it, because silo clamps a limit over 500
 * to 500 and a non-positive one to 50, both silently.
 */
public record PageWindow(int limit, int offset) {

  /** The window one page ahead. */
  public PageWindow next() {
    return new PageWindow(limit, offset + limit);
  }

  /** The window one page back, or empty before the start. */
  public Optional<PageWindow> previous() {
    if (offset <= 0) return Optional.empty();
    return Optional.of(new PageWindow(limit, Math.max(0, offset - limit)));
  }
}
