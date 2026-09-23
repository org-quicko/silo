import '../collections/collection_definition.dart';
import '../collections/collection_handle.dart';
import '../collections/collections.dart';
import '../collections/fields_converter.dart';
import '../request_options.dart';
import '../search/search.dart';
import '../search/search_page.dart';
import '../search/search_query.dart';
import '../search/search_reach.dart';
import '../transport/api_path.dart';
import '../transport/json_values.dart';
import '../transport/transport_request.dart';
import '../variables/environment_variables.dart';
import 'delete_options.dart';
import 'rename_options.dart';
import 'rename_report.dart';
import 'scope_reference.dart';

/// One environment by name. Immutable, like `ProjectHandle`.
final class EnvironmentHandle {
  EnvironmentHandle(this._scope) : collections = Collections(_scope), variables = EnvironmentVariables(_scope);

  final ScopeReference _scope;
  final Collections collections;
  final EnvironmentVariables variables;

  String get name => _scope.environment;

  String get project => _scope.project;

  /// Rows as maps. `withConverter` types them.
  CollectionHandle<Map<String, Object?>> collection(String name) => CollectionHandle(_scope, name, FieldsConverter.map);

  /// Every schema in the environment, in one request.
  Future<List<CollectionDefinition>> schemas([RequestOptions options = const RequestOptions()]) async {
    final body = await _scope.transport.json(
      TransportRequest('GET', ApiPath.schemas(_scope.project, _scope.environment), options: options),
    );
    return JsonValues.objects(body['items']).map(CollectionDefinition.fromJson).toList();
  }

  Future<SearchPage> search(SearchQuery query, [RequestOptions options = const RequestOptions()]) =>
      Search(_scope.transport, SearchReach.environment(_scope.project, _scope.environment)).run(query, options);

  Future<RenameReport> rename(String name, [RenameOptions options = const RenameOptions()]) async =>
      RenameReport.fromJson(
        await _scope.transport.json(
          TransportRequest(
            'PATCH',
            ApiPath.environment(_scope.project, _scope.environment),
            query: {if (options.dryRun) 'dry_run': true, 'expected_id': ?options.expectedId},
            body: {'name': name},
            options: options,
          ),
        ),
      );

  Future<void> delete([DeleteOptions options = const DeleteOptions()]) => _scope.transport.empty(
    TransportRequest(
      'DELETE',
      ApiPath.environment(_scope.project, _scope.environment),
      query: {if (options.force) 'force': true},
      options: options,
    ),
  );
}
