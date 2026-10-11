import 'dart:async';

import '../errors/request_aborted_exception.dart';
import '../request_options.dart';
import 'page_window.dart';

/// Loads the page at a window, and answers the window the server used.
typedef RowLoader<Row> = Future<({List<Row> rows, PageWindow window})> Function(PageWindow window);

/// Rows one at a time across every page, loaded lazily. Advances by the echoed
/// window and stops on the first short page. Not a snapshot of data being written.
class RowStream<Row> extends Stream<Row> {
  RowStream(this._loader, this._startingLimit, this._options);

  final RowLoader<Row> _loader;
  final int _startingLimit;
  final RequestOptions _options;

  @override
  StreamSubscription<Row> listen(
    void Function(Row row)? onData, {
    Function? onError,
    void Function()? onDone,
    bool? cancelOnError,
  }) => _rows().listen(onData, onError: onError, onDone: onDone, cancelOnError: cancelOnError);

  Stream<Row> _rows() async* {
    PageWindow? window = PageWindow(_startingLimit, 0);
    while (window != null) {
      if (_options.cancellation?.isCancelled ?? false) throw const RequestAbortedException('GET', 'stream');
      final batch = await _loader(window);
      for (final row in batch.rows) {
        yield row;
      }
      final short = batch.rows.isEmpty || batch.rows.length < batch.window.limit;
      window = short ? null : batch.window.next();
    }
  }
}
