import '../request_options.dart';
import '../transport/api_path.dart';
import '../transport/json_values.dart';
import '../transport/transport.dart';
import '../transport/transport_request.dart';
import 'media_folder_delete_options.dart';
import 'media_folder_move_options.dart';

/// The folder tree. A folder is a record, so it can exist while empty.
final class MediaFolders {
  const MediaFolders(this._transport);

  final Transport _transport;

  Future<List<String>> list([RequestOptions options = const RequestOptions()]) async => JsonValues.strings(
    (await _transport.json(TransportRequest('GET', ApiPath.mediaFolders(), options: options)))['items'],
  );

  /// Answers the path the server settled on.
  Future<String> create(String path, [RequestOptions options = const RequestOptions()]) async =>
      (await _transport.json(
            TransportRequest('POST', ApiPath.mediaFolders(), body: {'path': path}, options: options),
          ))['path']
          as String;

  Future<({String from, String to})> rename(
    String from,
    String to, [
    MediaFolderMoveOptions options = const MediaFolderMoveOptions(),
  ]) async {
    final body = await _transport.json(
      TransportRequest(
        'PATCH',
        ApiPath.mediaFolders(),
        body: {'from': from, 'to': to, 'merge': options.merge},
        options: options,
      ),
    );
    return (from: body['from'] as String, to: body['to'] as String);
  }

  /// The path travels as `?path=`, since it contains `/`.
  Future<void> delete(String path, [MediaFolderDeleteOptions options = const MediaFolderDeleteOptions()]) =>
      _transport.empty(
        TransportRequest(
          'DELETE',
          ApiPath.mediaFolders(),
          query: {'path': path, if (options.recursive) 'recursive': true, if (options.force) 'force': true},
          options: options,
        ),
      );
}
