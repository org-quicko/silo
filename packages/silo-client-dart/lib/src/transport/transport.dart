import 'dart:convert';

import 'package:http/http.dart' as http;

import '../cache/response_cache.dart';
import '../errors/error_factory.dart';
import '../errors/network_exception.dart';
import '../errors/request_aborted_exception.dart';
import '../errors/request_timeout_exception.dart';
import '../silo_options.dart';
import 'abort_trigger.dart';
import 'query_string.dart';
import 'response_decoder.dart';
import 'transport_request.dart';

/// The one place a request is made. Nothing is retried.
///
/// The abort trigger is raced as well as handed to the client, so a client
/// that ignores `abortTrigger` still honours deadlines and cancellation.
final class Transport {
  Transport(SiloOptions options)
    : _options = options,
      _url = _normalize(options.url),
      client = options.httpClient ?? http.Client(),
      _ownsClient = options.httpClient == null,
      cache = ResponseCache(options.cache);

  final SiloOptions _options;
  final String _url;
  final http.Client client;
  final bool _ownsClient;
  final ResponseCache cache;

  /// A route that answers a JSON object.
  Future<Map<String, Object?>> json(TransportRequest request) async {
    final policy = request.cachePolicy;
    final text = policy != null && request.method == 'GET' && cache.isEnabled
        ? await cache.get(policy, request.method, request.path, request.query, () => _jsonText(request))
        : await _jsonText(request);
    return jsonDecode(text ?? '{}') as Map<String, Object?>;
  }

  /// A route that answers `204`.
  Future<void> empty(TransportRequest request) => _execute(request);

  Future<Map<String, Object?>> upload(
    TransportRequest request,
    http.MultipartFile file, [
    Map<String, String> fields = const {},
  ]) async {
    final response = await _execute(request, file: file, fields: fields);
    return jsonDecode(ResponseDecoder.jsonText(response, request) ?? '{}') as Map<String, Object?>;
  }

  void close() {
    if (_ownsClient) client.close();
  }

  Future<String?> _jsonText(TransportRequest request) async =>
      ResponseDecoder.jsonText(await _execute(request), request);

  Future<http.Response> _execute(
    TransportRequest request, {
    http.MultipartFile? file,
    Map<String, String> fields = const {},
  }) async {
    final options = request.options;
    if (options.cancellation?.isCancelled ?? false) {
      throw RequestAbortedException(request.method, request.path);
    }

    final timeout = options.timeout ?? _options.timeout;
    final trigger = AbortTrigger(options.cancellation, timeout);
    final http.Response response;
    try {
      final sent = client.send(_build(request, trigger.fired, file, fields)).then(http.Response.fromStream);
      response = await Future.any([sent, trigger.fired.then<http.Response>((_) => throw const _Aborted())]);
    } on Exception catch (caught) {
      throw switch (trigger.firedBy) {
        AbortReason.timeout => RequestTimeoutException(request.method, request.path, timeout!),
        AbortReason.caller => RequestAbortedException(request.method, request.path),
        null => NetworkException(request.method, request.path, caught),
      };
    } finally {
      trigger.dispose();
    }

    if (response.statusCode < 200 || response.statusCode > 299) {
      throw ErrorFactory.fromResponseBody(
        response.statusCode,
        request.method,
        request.path,
        utf8.decode(response.bodyBytes, allowMalformed: true),
      );
    }
    cache.invalidate(request.evicts);
    return response;
  }

  http.BaseRequest _build(
    TransportRequest request,
    Future<void> abortTrigger,
    http.MultipartFile? file,
    Map<String, String> fields,
  ) {
    final url = Uri.parse('$_url${request.path}${QueryString.build(request.query)}');
    final headers = {
      ..._options.headers,
      if (_options.key case final key? when key.isNotEmpty) 'Authorization': 'Bearer $key',
    };

    if (file != null) {
      return http.AbortableMultipartRequest(request.method, url, abortTrigger: abortTrigger)
        ..headers.addAll(headers)
        ..fields.addAll(fields)
        ..files.add(file);
    }

    final built = http.AbortableRequest(request.method, url, abortTrigger: abortTrigger)..headers.addAll(headers);
    if (request.body case final body?) {
      built.headers.putIfAbsent('content-type', () => 'application/json');
      built.bodyBytes = utf8.encode(jsonEncode(body));
    }
    return built;
  }

  static String _normalize(String url) {
    if (url.trim().isEmpty) throw ArgumentError.value(url, 'url', 'needs the URL of a silo instance');
    return url.replaceFirst(RegExp(r'/+$'), '');
  }
}

final class _Aborted implements Exception {
  const _Aborted();
}
