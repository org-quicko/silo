import '../transport/api_path.dart';
import '../transport/transport.dart';
import '../transport/transport_request.dart';
import '../variables/project_variables.dart';
import 'delete_options.dart';
import 'environment_handle.dart';
import 'environments.dart';
import 'rename_options.dart';
import 'rename_report.dart';
import 'scope_reference.dart';

/// One project by name. Immutable: after a rename it still addresses the old
/// name, so build a new handle.
final class ProjectHandle {
  ProjectHandle(this._transport, this.name)
    : environments = Environments(_transport, name),
      variables = ProjectVariables(_transport, name);

  final Transport _transport;
  final String name;
  final Environments environments;
  final ProjectVariables variables;

  EnvironmentHandle environment(String name) => EnvironmentHandle(ScopeReference(_transport, this.name, name));

  Future<RenameReport> rename(String name, [RenameOptions options = const RenameOptions()]) async =>
      RenameReport.fromJson(
        await _transport.json(
          TransportRequest(
            'PATCH',
            ApiPath.project(this.name),
            query: {if (options.dryRun) 'dry_run': true, 'expected_id': ?options.expectedId},
            body: {'name': name},
            options: options,
          ),
        ),
      );

  Future<void> delete([DeleteOptions options = const DeleteOptions()]) => _transport.empty(
    TransportRequest('DELETE', ApiPath.project(name), query: {if (options.force) 'force': true}, options: options),
  );
}
