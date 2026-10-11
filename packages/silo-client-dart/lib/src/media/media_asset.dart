import '../request_options.dart';
import '../scope/delete_options.dart';
import '../transport/api_path.dart';
import '../transport/transport.dart';
import '../transport/transport_request.dart';
import 'media_asset_record.dart';
import 'media_parts.dart';
import 'media_reference.dart';
import 'media_replace.dart';
import 'media_state.dart';
import 'media_usage_page.dart';
import 'media_usage_query.dart';

/// A catalogued asset, live. A mutating call adopts the server's answer in
/// place and returns this.
///
/// Store [reference] in an entry, never [url]: a rename or move keeps the
/// reference and can change the URL.
final class MediaAsset {
  MediaAsset(this._transport, this._record);

  final Transport _transport;
  MediaAssetRecord _record;

  MediaAssetRecord get record => _record;
  String get id => _record.id;
  String get filename => _record.filename;
  String get folder => _record.folder;
  String get blobKey => _record.blobKey;
  int get sizeInBytes => _record.sizeInBytes;
  String get contentType => _record.contentType;
  String get hash => _record.hash;
  MediaState get state => _record.state;
  List<String> get tags => _record.tags;
  String get url => _record.url;
  int get usageCount => _record.usageCount;
  DateTime get createdAt => _record.createdAt;
  DateTime get updatedAt => _record.updatedAt;

  /// `silo://media/<id>`.
  String get reference => MediaReference.of(id);

  Future<MediaAsset> rename(String filename, [RequestOptions options = const RequestOptions()]) =>
      _patch({'filename': filename}, options);

  Future<MediaAsset> moveTo(String folder, [RequestOptions options = const RequestOptions()]) =>
      _patch({'folder': folder}, options);

  /// Replaces the list; it does not append.
  Future<MediaAsset> setTags(List<String> tags, [RequestOptions options = const RequestOptions()]) =>
      _patch({'tags': tags}, options);

  /// Swaps the bytes and keeps the id, reference, URL, filename and folder.
  /// Every entry pointing here shows the new file.
  Future<MediaAsset> replace(MediaReplace input, [RequestOptions options = const RequestOptions()]) async {
    _record = MediaAssetRecord.fromJson(
      await _transport.upload(
        TransportRequest('POST', ApiPath.mediaAssetContent(id), options: options),
        MediaParts.file(input.bytes, input.filename, input.contentType),
      ),
    );
    return this;
  }

  /// Refused while an entry references it, unless forced.
  Future<void> delete([DeleteOptions options = const DeleteOptions()]) => _transport.empty(
    TransportRequest('DELETE', ApiPath.mediaAsset(id), query: {if (options.force) 'force': true}, options: options),
  );

  Future<MediaUsagePage> usages([
    MediaUsageQuery query = const MediaUsageQuery(),
    RequestOptions options = const RequestOptions(),
  ]) => MediaUsagePage.load(_transport, id, query, options);

  Future<MediaAsset> refresh([RequestOptions options = const RequestOptions()]) async {
    _record = MediaAssetRecord.fromJson(
      await _transport.json(TransportRequest('GET', ApiPath.mediaAsset(id), options: options)),
    );
    return this;
  }

  Future<MediaAsset> _patch(Map<String, Object?> body, RequestOptions options) async {
    _record = MediaAssetRecord.fromJson(
      await _transport.json(TransportRequest('PATCH', ApiPath.mediaAsset(id), body: body, options: options)),
    );
    return this;
  }
}
