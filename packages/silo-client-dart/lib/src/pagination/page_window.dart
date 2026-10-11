import 'dart:math';

/// The `limit` and `offset` a page answered, as the server clamped them.
final class PageWindow {
  const PageWindow(this.limit, this.offset);

  final int limit;
  final int offset;

  PageWindow next() => PageWindow(limit, offset + limit);

  PageWindow? previous() => offset <= 0 ? null : PageWindow(limit, max(0, offset - limit));
}
