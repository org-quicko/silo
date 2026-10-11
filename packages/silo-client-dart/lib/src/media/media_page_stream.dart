import 'dart:async';

import '../errors/request_aborted_exception.dart';
import '../request_options.dart';
import 'media_page.dart';

/// What `Media.pages` answers: whole pages until one reports no more.
final class MediaPageStream extends Stream<MediaPage> {
  MediaPageStream(this._first, this._options);

  final Future<MediaPage> Function() _first;
  final RequestOptions _options;

  @override
  StreamSubscription<MediaPage> listen(
    void Function(MediaPage page)? onData, {
    Function? onError,
    void Function()? onDone,
    bool? cancelOnError,
  }) => _pages().listen(onData, onError: onError, onDone: onDone, cancelOnError: cancelOnError);

  Stream<MediaPage> _pages() async* {
    MediaPage? page = await _first();
    while (page != null) {
      if (_options.cancellation?.isCancelled ?? false) throw const RequestAbortedException('GET', 'stream');
      yield page;
      page = page.hasMore ? await page.next(_options) : null;
    }
  }
}
