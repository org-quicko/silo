import '../request_options.dart';
import '../transport/api_path.dart';
import '../transport/json_values.dart';
import '../transport/transport.dart';
import '../transport/transport_request.dart';
import 'environment.dart';

final class Environments {
  const Environments(this._transport, this._project);

  final Transport _transport;
  final String _project;

  Future<List<Environment>> list([RequestOptions options = const RequestOptions()]) async {
    final body = await _transport.json(TransportRequest('GET', ApiPath.environments(_project), options: options));
    return JsonValues.objects(body['items']).map(Environment.fromJson).toList();
  }

  Future<Environment> create(String name, [RequestOptions options = const RequestOptions()]) async =>
      Environment.fromJson(
        await _transport.json(
          TransportRequest('POST', ApiPath.environments(_project), body: {'id': name}, options: options),
        ),
      );
}
