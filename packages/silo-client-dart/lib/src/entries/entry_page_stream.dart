import 'dart:async';

import '../errors/request_aborted_exception.dart';
import '../request_options.dart';
import 'entry_page.dart';

/// What `pages()` answers: whole pages, stopping on the first short one.
final class EntryPageStream<F> extends Stream<EntryPage<F>> {
  EntryPageStream(this._first, this._options);

  final Future<EntryPage<F>> Function() _first;
  final RequestOptions _options;

  @override
  StreamSubscription<EntryPage<F>> listen(
    void Function(EntryPage<F> page)? onData, {
    Function? onError,
    void Function()? onDone,
    bool? cancelOnError,
  }) => _pages().listen(onData, onError: onError, onDone: onDone, cancelOnError: cancelOnError);

  Stream<EntryPage<F>> _pages() async* {
    EntryPage<F>? page = await _first();
    while (page != null) {
      if (_options.cancellation?.isCancelled ?? false) throw const RequestAbortedException('GET', 'stream');
      yield page;
      page = page.isEmpty || page.length < page.limit ? null : await page.next();
    }
  }
}
