import '../entries/entry.dart';
import '../entries/entry_list_query.dart';
import '../entries/entry_mapper.dart';
import '../entries/entry_page.dart';
import '../entries/entry_page_stream.dart';
import '../entries/entry_read_options.dart';
import '../entries/entry_reader.dart';
import '../entries/entry_stream.dart';
import '../request_options.dart';
import '../scope/rename_options.dart';
import '../scope/rename_report.dart';
import '../scope/scope_reference.dart';
import '../search/search.dart';
import '../search/search_page.dart';
import '../search/search_query.dart';
import '../search/search_reach.dart';
import '../transport/api_path.dart';
import '../transport/transport_request.dart';
import 'collection_schema.dart';
import 'fields_converter.dart';

/// One collection, its fields read as [F].
///
/// Pass `EntryReadOptions.raw()` to read the stored `{{NAME}}` templates, which
/// editing requires. Every write here drops this collection from the cache.
final class CollectionHandle<F> {
  CollectionHandle(this._scope, this.name, this._converter)
    : schema = CollectionSchema(_scope, name),
      _reader = EntryReader(_scope, name, _converter);

  final ScopeReference _scope;
  final String name;
  final CollectionSchema schema;
  final FieldsConverter<F> _converter;
  final EntryReader<F> _reader;

  /// The same collection with its fields read into, and written from, [R].
  CollectionHandle<R> withConverter<R>({
    required R Function(Map<String, Object?> json) fromJson,
    required Map<String, Object?> Function(R fields) toJson,
  }) => CollectionHandle(_scope, name, FieldsConverter(fromJson: fromJson, toJson: toJson));

  Future<Entry<F>> get(String id, [EntryReadOptions options = const EntryReadOptions()]) => _reader.get(id, options);

  Future<EntryPage<F>> list([
    EntryListQuery query = const EntryListQuery(),
    EntryReadOptions options = const EntryReadOptions(),
  ]) => _reader.list(query, options);

  /// Every matching entry, paged lazily. Not a snapshot of data being written.
  EntryStream<F> all([
    EntryListQuery query = const EntryListQuery(),
    EntryReadOptions options = const EntryReadOptions(),
  ]) => _reader.all(query, options);

  EntryPageStream<F> pages([
    EntryListQuery query = const EntryListQuery(),
    EntryReadOptions options = const EntryReadOptions(),
  ]) => _reader.pages(query, options);

  Future<Entry<F>> create(F fields, [RequestOptions options = const RequestOptions()]) =>
      _write('POST', ApiPath.entries(_scope.project, _scope.environment, name), fields, null, options);

  /// A full replace. [rev] is the one the entry was read with; a stale one is
  /// a `ConflictException`.
  Future<Entry<F>> replace(String id, int rev, F fields, [RequestOptions options = const RequestOptions()]) =>
      _write('PUT', ApiPath.entry(_scope.project, _scope.environment, name, id), fields, rev, options);

  Future<void> delete(String id, int rev, [RequestOptions options = const RequestOptions()]) => _scope.transport.empty(
    TransportRequest(
      'DELETE',
      ApiPath.entry(_scope.project, _scope.environment, name, id),
      query: {'rev': rev},
      options: options,
      evicts: _entries,
    ),
  );

  Future<SearchPage> search(SearchQuery query, [RequestOptions options = const RequestOptions()]) =>
      Search(_scope.transport, SearchReach.collection(_scope.project, _scope.environment, name)).run(query, options);

  Future<RenameReport> rename(String name, [RenameOptions options = const RenameOptions()]) async =>
      RenameReport.fromJson(
        await _scope.transport.json(
          TransportRequest(
            'PATCH',
            ApiPath.collection(_scope.project, _scope.environment, this.name),
            query: {if (options.dryRun) 'dry_run': true, 'expected_id': ?options.expectedId},
            body: {'name': name},
            options: options,
            evicts: _entries,
          ),
        ),
      );

  /// Asks for the stored templates back, so what returns is what was sent.
  Future<Entry<F>> _write(String method, String path, F fields, int? rev, RequestOptions options) async {
    final row = await _scope.transport.json(
      TransportRequest(
        method,
        path,
        query: {'rev': ?rev, 'variables': 'raw'},
        body: _converter.toJson(fields),
        options: options,
        evicts: _entries,
      ),
    );
    return EntryMapper.read(row, _converter);
  }

  String get _entries => ApiPath.entries(_scope.project, _scope.environment, name);
}
