import '../pagination/page_window.dart';
import '../request_options.dart';
import '../scope/delete_options.dart';
import '../transport/api_path.dart';
import '../transport/json_values.dart';
import '../transport/transport.dart';
import '../transport/transport_request.dart';
import 'media_asset.dart';
import 'media_asset_record.dart';
import 'media_delete_report.dart';
import 'media_folders.dart';
import 'media_page.dart';
import 'media_page_stream.dart';
import 'media_parts.dart';
import 'media_query.dart';
import 'media_stream.dart';
import 'media_upload.dart';

/// The media library: how you find or add an asset. `MediaAsset` is what you
/// do to one.
final class Media {
  Media(this._transport) : folders = MediaFolders(_transport);

  static const _bulkDeleteCap = 100;

  final Transport _transport;
  final MediaFolders folders;

  Future<MediaAsset> upload(MediaUpload input, [RequestOptions options = const RequestOptions()]) async => MediaAsset(
    _transport,
    MediaAssetRecord.fromJson(
      await _transport.upload(
        TransportRequest('POST', ApiPath.media(), options: options),
        MediaParts.file(input.bytes, input.filename, input.contentType),
        {if (input.folder case final folder? when folder.isNotEmpty) 'folder': folder},
      ),
    ),
  );

  Future<MediaAsset> get(String id, [RequestOptions options = const RequestOptions()]) async => MediaAsset(
    _transport,
    MediaAssetRecord.fromJson(await _transport.json(TransportRequest('GET', ApiPath.mediaAsset(id), options: options))),
  );

  Future<MediaPage> list([MediaQuery query = const MediaQuery(), RequestOptions options = const RequestOptions()]) =>
      MediaPage.load(_transport, query.toWire(), PageWindow(query.limit ?? 50, query.offset ?? 0), options);

  MediaStream all([MediaQuery query = const MediaQuery(), RequestOptions options = const RequestOptions()]) {
    final wireQuery = query.toWire();
    return MediaStream(
      (window) async {
        final page = await MediaPage.load(_transport, wireQuery, window, options);
        return (rows: page.files, window: PageWindow(page.limit, page.offset));
      },
      query.limit ?? 50,
      options,
    );
  }

  MediaPageStream pages([MediaQuery query = const MediaQuery(), RequestOptions options = const RequestOptions()]) =>
      MediaPageStream(() => list(query, options), options);

  /// Every distinct extension in the library.
  Future<List<String>> extensions([RequestOptions options = const RequestOptions()]) async => JsonValues.strings(
    (await _transport.json(TransportRequest('GET', ApiPath.mediaExtensions(), options: options)))['items'],
  );

  /// At most 100 ids. Per-id outcomes come back in the report.
  Future<MediaDeleteReport> deleteMany(List<String> ids, [DeleteOptions options = const DeleteOptions()]) async {
    if (ids.length > _bulkDeleteCap) {
      throw ArgumentError.value(ids.length, 'ids', 'deleteMany accepts at most $_bulkDeleteCap ids per request');
    }
    return MediaDeleteReport.fromJson(
      await _transport.json(
        TransportRequest(
          'POST',
          ApiPath.mediaBulkDelete(),
          body: {'ids': ids, 'force': options.force},
          options: options,
        ),
      ),
    );
  }
}
