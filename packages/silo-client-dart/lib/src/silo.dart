import 'cache/response_cache.dart';
import 'instance/health_report.dart';
import 'media/media.dart';
import 'request_options.dart';
import 'scope/environment_handle.dart';
import 'scope/project_handle.dart';
import 'scope/projects.dart';
import 'search/search.dart';
import 'search/search_page.dart';
import 'search/search_query.dart';
import 'search/search_reach.dart';
import 'silo_options.dart';
import 'transport/api_path.dart';
import 'transport/transport.dart';
import 'transport/transport_request.dart';

/// One silo instance: `silo.project('acme').environment('prod').collection('posts')`.
///
/// Handles make no request, and there is no default project or environment.
final class Silo {
  Silo(SiloOptions options) : this._(options, Transport(options));

  factory Silo.at(String url, {String? key}) => Silo(SiloOptions(url: url, key: key));

  Silo._(this._options, Transport transport)
    : _transport = transport,
      projects = Projects(transport),
      media = Media(transport);

  final SiloOptions _options;
  final Transport _transport;
  final Projects projects;

  /// Instance-global, so it takes no scope.
  final Media media;

  ResponseCache get cache => _transport.cache;

  ProjectHandle project(String name) => ProjectHandle(_transport, name);

  /// `project(project).environment(environment)` in one call.
  EnvironmentHandle scope(String project, String environment) => this.project(project).environment(environment);

  /// Everything this key can read. Narrower reaches are on the environment and
  /// collection handles.
  Future<SearchPage> search(SearchQuery query, [RequestOptions options = const RequestOptions()]) =>
      Search(_transport, SearchReach.instance()).run(query, options);

  /// Never authenticated.
  Future<HealthReport> health([RequestOptions options = const RequestOptions()]) async =>
      HealthReport.fromJson(await _transport.json(TransportRequest('GET', ApiPath.health(), options: options)));

  /// Shares this client's HTTP connection and starts with an empty cache.
  Silo withKey(String? key) => Silo(_derive(url: _options.url, key: key));

  Silo withUrl(String url) => Silo(_derive(url: url, key: _options.key));

  /// Closes the HTTP client unless it came from `SiloOptions.httpClient`.
  void close() => _transport.close();

  SiloOptions _derive({required String url, required String? key}) => SiloOptions(
    url: url,
    key: key,
    timeout: _options.timeout,
    headers: _options.headers,
    httpClient: _transport.client,
    cache: _options.cache,
  );
}
