import '../request_options.dart';
import '../scope/delete_options.dart';
import '../scope/scope_reference.dart';
import '../transport/api_path.dart';
import '../transport/transport_request.dart';
import 'collection_definition.dart';
import 'json_schema.dart';

/// One collection's schema. Deleting it deletes the collection.
final class CollectionSchema {
  const CollectionSchema(this._scope, this._name);

  final ScopeReference _scope;
  final String _name;

  Future<CollectionDefinition> get([RequestOptions options = const RequestOptions()]) async =>
      CollectionDefinition.fromJson(await _scope.transport.json(TransportRequest('GET', _path, options: options)));

  Future<CollectionDefinition> put(JsonSchema schema, [RequestOptions options = const RequestOptions()]) async =>
      CollectionDefinition.fromJson(
        await _scope.transport.json(TransportRequest('PUT', _path, body: schema, options: options)),
      );

  Future<void> delete([DeleteOptions options = const DeleteOptions()]) => _scope.transport.empty(
    TransportRequest(
      'DELETE',
      _path,
      query: {if (options.force) 'force': true},
      options: options,
      evicts: ApiPath.entries(_scope.project, _scope.environment, _name),
    ),
  );

  String get _path => ApiPath.collectionSchema(_scope.project, _scope.environment, _name);
}
