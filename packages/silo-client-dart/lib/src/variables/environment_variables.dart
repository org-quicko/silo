import '../request_options.dart';
import '../scope/scope_reference.dart';
import '../transport/api_path.dart';
import '../transport/json_values.dart';
import '../transport/transport_request.dart';
import 'variable.dart';

/// This environment's values.
final class EnvironmentVariables {
  const EnvironmentVariables(this._scope);

  final ScopeReference _scope;

  Future<List<Variable>> list([RequestOptions options = const RequestOptions()]) async {
    final body = await _scope.transport.json(
      TransportRequest('GET', ApiPath.environmentVariables(_scope.project, _scope.environment), options: options),
    );
    return JsonValues.objects(body['items']).map(Variable.fromJson).toList();
  }

  Future<Variable> set(String name, String value, [RequestOptions options = const RequestOptions()]) async =>
      Variable.fromJson(
        await _scope.transport.json(
          TransportRequest(
            'PUT',
            ApiPath.environmentVariable(_scope.project, _scope.environment, name),
            body: {'value': value},
            options: options,
          ),
        ),
      );

  /// Clears this environment's value and keeps the name declared.
  Future<Variable> unset(String name, [RequestOptions options = const RequestOptions()]) async => Variable.fromJson(
    await _scope.transport.json(
      TransportRequest(
        'DELETE',
        ApiPath.environmentVariable(_scope.project, _scope.environment, name),
        options: options,
      ),
    ),
  );
}
