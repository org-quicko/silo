import '../request_options.dart';
import '../scope/scope_reference.dart';
import '../transport/api_path.dart';
import '../transport/json_values.dart';
import '../transport/transport_request.dart';
import 'collection_definition.dart';
import 'collection_summary.dart';
import 'json_schema.dart';

final class Collections {
  const Collections(this._scope);

  final ScopeReference _scope;

  Future<List<CollectionSummary>> list([RequestOptions options = const RequestOptions()]) async {
    final body = await _scope.transport.json(
      TransportRequest('GET', ApiPath.collections(_scope.project, _scope.environment), options: options),
    );
    return JsonValues.objects(body['items']).map(CollectionSummary.fromJson).toList();
  }

  Future<CollectionDefinition> create(
    String name,
    JsonSchema schema, [
    RequestOptions options = const RequestOptions(),
  ]) async => CollectionDefinition.fromJson(
    await _scope.transport.json(
      TransportRequest(
        'POST',
        ApiPath.collections(_scope.project, _scope.environment),
        body: {'name': name, 'schema': schema},
        options: options,
      ),
    ),
  );
}
