import 'dart:math';

import 'package:meta/meta.dart';

import 'page_window.dart';

/// One page of results. [truncated] marks a [total] that counts what a scan
/// examined: [pageCount] is then null and [hasMore] means "this page is full".
abstract class Page<Row> extends Iterable<Row> {
  Page(this._rows, this.total, this._window, {this.truncated = false});

  final List<Row> _rows;
  final PageWindow _window;
  final int total;
  final bool truncated;

  int get limit => _window.limit;

  int get offset => _window.offset;

  int get pageNumber => offset ~/ limit + 1;

  int? get pageCount => truncated ? null : max(1, (total / limit).ceil());

  bool get hasMore => truncated ? _rows.length == limit : offset + _rows.length < total;

  @override
  Iterator<Row> get iterator => _rows.iterator;

  @override
  int get length => _rows.length;

  @protected
  PageWindow? windowForNext() => hasMore ? _window.next() : null;

  @protected
  PageWindow? windowForPrevious() => _window.previous();
}
