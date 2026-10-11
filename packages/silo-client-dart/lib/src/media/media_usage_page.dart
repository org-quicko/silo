import 'dart:math';

import '../pagination/page.dart';
import '../pagination/page_window.dart';
import '../request_options.dart';
import '../transport/api_path.dart';
import '../transport/json_values.dart';
import '../transport/transport.dart';
import '../transport/transport_request.dart';
import 'media_usage.dart';
import 'media_usage_query.dart';

/// One page of an asset's referrers. [total] is the true count; paging
/// follows [visible], what this key may read. The wire echoes no window.
final class MediaUsagePage extends Page<MediaUsage> {
  MediaUsagePage._(
    this.usages,
    int total,
    this.visible,
    this.visibleCapped,
    PageWindow window,
    this._transport,
    this._assetId,
  ) : super(usages, total, window);

  final List<MediaUsage> usages;
  final int visible;
  final bool visibleCapped;
  final Transport _transport;
  final String _assetId;

  @override
  int? get pageCount => max(1, (visible / limit).ceil());

  @override
  bool get hasMore => offset + usages.length < visible;

  Future<MediaUsagePage?> next([RequestOptions options = const RequestOptions()]) async {
    final window = windowForNext();
    return window == null ? null : _load(_transport, _assetId, window, options);
  }

  Future<MediaUsagePage?> previous([RequestOptions options = const RequestOptions()]) async {
    final window = windowForPrevious();
    return window == null ? null : _load(_transport, _assetId, window, options);
  }

  static Future<MediaUsagePage> load(
    Transport transport,
    String assetId,
    MediaUsageQuery query,
    RequestOptions options,
  ) => _load(transport, assetId, PageWindow(query.limit ?? 50, query.offset ?? 0), options);

  static Future<MediaUsagePage> _load(
    Transport transport,
    String assetId,
    PageWindow window,
    RequestOptions options,
  ) async {
    final body = await transport.json(
      TransportRequest(
        'GET',
        ApiPath.mediaAssetUsages(assetId),
        query: {'limit': window.limit, 'offset': window.offset},
        options: options,
      ),
    );
    return MediaUsagePage._(
      JsonValues.objects(body['items']).map(MediaUsage.fromJson).toList(),
      body['total'] as int,
      body['visible'] as int,
      body['visible_capped'] == true,
      window,
      transport,
      assetId,
    );
  }
}
