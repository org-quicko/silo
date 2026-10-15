import '../pagination/page_window.dart';
import '../request_options.dart';
import '../transport/api_path.dart';
import '../transport/transport.dart';
import '../transport/transport_request.dart';
import 'trash_contents_query.dart';
import 'trash_page.dart';
import 'trash_parked_records.dart';
import 'trash_query.dart';
import 'trash_record.dart';
import 'trash_restore_options.dart';
import 'trash_restore_result.dart';

/// The trash (D113): what a delete left behind, and the two ways out of it.
///
/// Instance-global like media, so it takes no scope. Reading needs no claim of
/// its own: each key sees only the items whose content it may read.
final class Trash {
  Trash(this._transport);

  final Transport _transport;

  Future<TrashPage> list([TrashQuery query = const TrashQuery(), RequestOptions options = const RequestOptions()]) =>
      TrashPage.load(_transport, query.toWire(), PageWindow(query.limit ?? 50, query.offset ?? 0), options);

  Future<TrashRecord> get(String id, [RequestOptions options = const RequestOptions()]) async =>
      TrashRecord.fromJson(await _transport.json(TransportRequest('GET', ApiPath.trashItem(id), options: options)));

  /// The records this receipt parked. Read-only: a restore is all or nothing
  /// per receipt.
  Future<TrashParkedRecords> contents(
    String id, [
    TrashContentsQuery query = const TrashContentsQuery(),
    RequestOptions options = const RequestOptions(),
  ]) async => TrashParkedRecords.fromJson(
    await _transport.json(
      TransportRequest(
        'GET',
        ApiPath.trashItemContents(id),
        query: {'limit': ?query.limit, 'offset': ?query.offset},
        options: options,
      ),
    ),
  );

  /// Puts the content back. Needs the write claims at the destination; a
  /// blocked or colliding restore is a `ConflictException`. A restore can bring
  /// entries back to any collection, so it drops every cached entry read.
  Future<TrashRestoreResult> restore(String id, [TrashRestoreOptions options = const TrashRestoreOptions()]) async =>
      TrashRestoreResult.fromJson(
        await _transport.json(
          TransportRequest(
            'POST',
            ApiPath.trashRestore(id),
            body: {'rename': ?options.rename, 'chain': options.chain},
            options: options,
            evicts: ApiPath.projects(),
          ),
        ),
      );

  /// Destroys one receipt and everything it parked. Needs `trash:purge`.
  Future<void> purge(String id, [RequestOptions options = const RequestOptions()]) =>
      _transport.empty(TransportRequest('DELETE', ApiPath.trashItem(id), options: options));

  /// Empties the trash and answers how many receipts it destroyed. Needs
  /// `trash:purge`. Sends the confirmation word the route asks for, because
  /// calling `empty` is already the deliberate act that word guards.
  Future<int> empty([RequestOptions options = const RequestOptions()]) async {
    final body = await _transport.json(
      TransportRequest('POST', ApiPath.trashPurge(), body: {'confirm': 'empty'}, options: options),
    );
    return body['purged'] as int? ?? 0;
  }
}
