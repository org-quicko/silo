import '../pagination/page.dart';
import '../pagination/page_window.dart';
import '../request_options.dart';
import '../transport/api_path.dart';
import '../transport/page_payload.dart';
import '../transport/transport.dart';
import '../transport/transport_request.dart';
import 'trash_record.dart';

/// One page of `Trash.list`, navigated by the window the server answered.
final class TrashPage extends Page<TrashRecord> {
  TrashPage._(this.items, int total, PageWindow window, this._transport, this._wireQuery) : super(items, total, window);

  final List<TrashRecord> items;
  final Transport _transport;
  final Map<String, Object?> _wireQuery;

  Future<TrashPage?> next([RequestOptions options = const RequestOptions()]) async {
    final window = windowForNext();
    return window == null ? null : load(_transport, _wireQuery, window, options);
  }

  Future<TrashPage?> previous([RequestOptions options = const RequestOptions()]) async {
    final window = windowForPrevious();
    return window == null ? null : load(_transport, _wireQuery, window, options);
  }

  static Future<TrashPage> load(
    Transport transport,
    Map<String, Object?> wireQuery,
    PageWindow window,
    RequestOptions options,
  ) async {
    final body = await transport.json(
      TransportRequest(
        'GET',
        ApiPath.trash(),
        query: {...wireQuery, 'limit': window.limit, 'offset': window.offset},
        options: options,
      ),
    );
    final payload = PagePayload.read(body);
    return TrashPage._(
      payload.rows.map(TrashRecord.fromJson).toList(),
      payload.total,
      PageWindow(payload.limit ?? window.limit, payload.offset ?? window.offset),
      transport,
      wireQuery,
    );
  }
}
