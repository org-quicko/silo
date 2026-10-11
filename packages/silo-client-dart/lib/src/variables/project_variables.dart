import '../transport/api_path.dart';
import '../transport/transport.dart';
import '../transport/transport_request.dart';
import 'declare_variable_options.dart';
import 'variable.dart';
import 'variable_environment_options.dart';

/// Declarations, project-wide. Values live on `EnvironmentVariables`.
final class ProjectVariables {
  const ProjectVariables(this._transport, this._project);

  final Transport _transport;
  final String _project;

  Future<Variable> declare(String name, [DeclareVariableOptions options = const DeclareVariableOptions()]) async =>
      Variable.fromJson(
        await _transport.json(
          TransportRequest(
            'POST',
            ApiPath.projectVariables(_project),
            query: {'env': ?options.environment},
            body: {'name': name, 'description': ?options.description, 'value': ?options.value},
            options: options,
          ),
        ),
      );

  Future<Variable> rename(
    String name,
    String to, [
    VariableEnvironmentOptions options = const VariableEnvironmentOptions(),
  ]) => _update(name, {'name': to}, options);

  Future<Variable> describe(
    String name,
    String description, [
    VariableEnvironmentOptions options = const VariableEnvironmentOptions(),
  ]) => _update(name, {'description': description}, options);

  /// Forgets the name and every environment's value.
  Future<void> undeclare(String name, [VariableEnvironmentOptions options = const VariableEnvironmentOptions()]) =>
      _transport.empty(
        TransportRequest(
          'DELETE',
          ApiPath.projectVariable(_project, name),
          query: {'env': ?options.environment},
          options: options,
        ),
      );

  Future<Variable> _update(String name, Map<String, Object?> body, VariableEnvironmentOptions options) async =>
      Variable.fromJson(
        await _transport.json(
          TransportRequest(
            'PATCH',
            ApiPath.projectVariable(_project, name),
            query: {'env': ?options.environment},
            body: body,
            options: options,
          ),
        ),
      );
}
