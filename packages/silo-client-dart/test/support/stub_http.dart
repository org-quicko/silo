import 'dart:async';
import 'dart:collection';
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:silo_client/silo_client.dart';

/// Records every request and answers the next queued response, never opening a socket.
final class StubHttp {
  final List<http.Request> requests = [];
  final Queue<Future<http.Response> Function()> _answers = Queue();

  late final http.Client client = MockClient((request) {
    requests.add(request);
    return _answers.removeFirst()();
  });

  http.Request get last => requests.last;

  Map<String, Object?> get lastBody => jsonDecode(last.body) as Map<String, Object?>;

  void json(Object? body, {int status = 200}) => _answers.add(
    () async =>
        http.Response.bytes(utf8.encode(jsonEncode(body)), status, headers: {'content-type': 'application/json'}),
  );

  void text(String body, {int status = 200, String contentType = 'text/html'}) =>
      _answers.add(() async => http.Response(body, status, headers: {'content-type': contentType}));

  void empty() => _answers.add(() async => http.Response('', 204));

  void hang() => _answers.add(() => Completer<http.Response>().future);

  void fail(Object error) => _answers.add(() async => throw error);

  Silo silo({String? key = 'test-key', CacheOptions cache = const CacheOptions.off(), Duration? timeout}) =>
      Silo(SiloOptions(url: 'http://silo.test/', key: key, httpClient: client, cache: cache, timeout: timeout));
}

Map<String, Object?> row(String id, {int rev = 1, Map<String, Object?> fields = const {}}) => {
  'id': id,
  'rev': rev,
  'created_at': '2026-09-01T10:00:00Z',
  'updated_at': '2026-09-02T10:00:00Z',
  ...fields,
};

Map<String, Object?> page(List<Map<String, Object?>> rows, {int? total, int limit = 50, int offset = 0}) => {
  'data': rows,
  'total': total ?? rows.length,
  'limit': limit,
  'offset': offset,
};

final class Post {
  const Post(this.title, this.status);

  factory Post.fromJson(Map<String, dynamic> json) => Post(json['title'] as String, json['status'] as String);

  final String title;
  final String status;

  Map<String, dynamic> toJson() => {'title': title, 'status': status};
}
