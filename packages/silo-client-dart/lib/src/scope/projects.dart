import '../request_options.dart';
import '../transport/api_path.dart';
import '../transport/json_values.dart';
import '../transport/transport.dart';
import '../transport/transport_request.dart';
import 'project.dart';

final class Projects {
  const Projects(this._transport);

  final Transport _transport;

  Future<List<Project>> list([RequestOptions options = const RequestOptions()]) async {
    final body = await _transport.json(TransportRequest('GET', ApiPath.projects(), options: options));
    return JsonValues.objects(body['items']).map(Project.fromJson).toList();
  }

  Future<Project> create(String name, [RequestOptions options = const RequestOptions()]) async => Project.fromJson(
    await _transport.json(TransportRequest('POST', ApiPath.projects(), body: {'id': name}, options: options)),
  );
}
