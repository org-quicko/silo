import '../pagination/page.dart';
import '../pagination/page_window.dart';
import '../request_options.dart';
import '../transport/api_path.dart';
import '../transport/page_payload.dart';
import '../transport/transport.dart';
import '../transport/transport_request.dart';
import 'media_asset.dart';
import 'media_asset_record.dart';

/// One page of `Media.list`, navigated by the window the server answered.
final class MediaPage extends Page<MediaAsset> {
  MediaPage._(this.files, int total, PageWindow window, this._transport, this._wireQuery) : super(files, total, window);

  final List<MediaAsset> files;
  final Transport _transport;
  final Map<String, Object?> _wireQuery;

  Future<MediaPage?> next([RequestOptions options = const RequestOptions()]) async {
    final window = windowForNext();
    return window == null ? null : load(_transport, _wireQuery, window, options);
  }

  Future<MediaPage?> previous([RequestOptions options = const RequestOptions()]) async {
    final window = windowForPrevious();
    return window == null ? null : load(_transport, _wireQuery, window, options);
  }

  static Future<MediaPage> load(
    Transport transport,
    Map<String, Object?> wireQuery,
    PageWindow window,
    RequestOptions options,
  ) async {
    final body = await transport.json(
      TransportRequest(
        'GET',
        ApiPath.media(),
        query: {...wireQuery, 'limit': window.limit, 'offset': window.offset},
        options: options,
      ),
    );
    final payload = PagePayload.read(body);
    return MediaPage._(
      [for (final row in payload.rows) MediaAsset(transport, MediaAssetRecord.fromJson(row))],
      payload.total,
      PageWindow(payload.limit ?? window.limit, payload.offset ?? window.offset),
      transport,
      wireQuery,
    );
  }
}
