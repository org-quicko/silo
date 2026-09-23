import '../cache/cache_policy.dart';
import '../collections/fields_converter.dart';
import '../pagination/page_window.dart';
import '../scope/scope_reference.dart';
import '../transport/api_path.dart';
import '../transport/page_payload.dart';
import '../transport/transport_request.dart';
import 'entry.dart';
import 'entry_list_query.dart';
import 'entry_mapper.dart';
import 'entry_page.dart';
import 'entry_page_stream.dart';
import 'entry_read_options.dart';
import 'entry_stream.dart';

/// The four reads of one collection. `get` and `list` are the only cached
/// reads; `all` and `pages` are cached because they page through `list`.
final class EntryReader<F> {
  const EntryReader(this._scope, this._collection, this._converter);

  final ScopeReference _scope;
  final String _collection;
  final FieldsConverter<F> _converter;

  Future<Entry<F>> get(String id, EntryReadOptions options) async {
    final row = await _scope.transport.json(
      TransportRequest(
        'GET',
        ApiPath.entry(_scope.project, _scope.environment, _collection, id),
        query: {'variables': ?options.variables.wireValue},
        options: options,
        cachePolicy: const CachePolicy(),
      ),
    );
    return EntryMapper.read(row, _converter);
  }

  Future<EntryPage<F>> list(EntryListQuery query, EntryReadOptions options) async {
    final body = await _scope.transport.json(
      TransportRequest(
        'GET',
        ApiPath.entries(_scope.project, _scope.environment, _collection),
        query: {
          'limit': ?query.limit,
          'offset': ?query.offset,
          'filter': ?query.where?.toJson(),
          'sort': ?query.sort,
          'variables': ?options.variables.wireValue,
        },
        options: options,
        cachePolicy: const CachePolicy(),
      ),
    );

    final payload = PagePayload.read(body);
    return EntryPage(
      [for (final row in payload.rows) EntryMapper.read(row, _converter)],
      payload.total,
      PageWindow(payload.limit ?? query.limit ?? 50, payload.offset ?? query.offset ?? 0),
      (window) => list(query.copyWith(limit: window.limit, offset: window.offset), options),
    );
  }

  EntryStream<F> all(EntryListQuery query, EntryReadOptions options) => EntryStream(
    (window) async {
      final page = await list(query.copyWith(limit: window.limit, offset: window.offset), options);
      return (rows: page.entries, window: PageWindow(page.limit, page.offset));
    },
    query.limit ?? 50,
    options,
  );

  EntryPageStream<F> pages(EntryListQuery query, EntryReadOptions options) =>
      EntryPageStream(() => list(query, options), options);
}
