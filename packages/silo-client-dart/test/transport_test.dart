import 'dart:async';

import 'package:http/http.dart' as http;
import 'package:silo_client/silo_client.dart';
import 'package:test/test.dart';

import 'support/stub_http.dart';

void main() {
  late StubHttp stub;
  setUp(() => stub = StubHttp());

  test('sends the key as a bearer token, and nothing when anonymous', () async {
    stub
      ..json({'status': 'ok', 'version': '1.4.0'})
      ..json({'status': 'ok', 'version': '1.4.0'});

    final health = await stub.silo().health();
    await stub.silo(key: null).health();

    expect(health.version, '1.4.0');
    expect(stub.requests[0].url.toString(), 'http://silo.test/api/health');
    expect(stub.requests[0].headers['authorization'], 'Bearer test-key');
    expect(stub.requests[1].headers.containsKey('authorization'), isFalse);
  });

  test('encodes a path segment the way encodeURIComponent does', () async {
    stub.json({'items': <Object?>[]});
    await stub.silo().project('a b/c').environments.list();
    expect(stub.last.url.path, '/api/projects/a%20b%2Fc/envs');
  });

  test('sends a JSON body with its content type', () async {
    stub.json({'id': '01P', 'name': 'acme'});
    final project = await stub.silo().projects.create('acme');

    expect(project.id, '01P');
    expect(stub.last.headers['content-type'], startsWith('application/json'));
    expect(stub.lastBody, {'id': 'acme'});
  });

  test('maps each wire code to its exception, and falls back on the status', () async {
    final silo = stub.silo();
    stub
      ..json({
        'error': {
          'code': 'validation_failed',
          'message': 'bad',
          'details': [
            {'path': '/title', 'message': 'required'},
          ],
        },
      }, status: 400)
      ..json({
        'error': {'code': 'not_found', 'message': 'gone'},
      }, status: 404)
      ..json({
        'error': {'code': 'something_new', 'message': 'stale'},
      }, status: 409)
      ..text('<html>bad gateway</html>', status: 502);

    await expectLater(
      silo.projects.list(),
      throwsA(isA<ValidationFailedException>().having((caught) => caught.details.single.path, 'path', '/title')),
    );
    await expectLater(silo.projects.list(), throwsA(isA<NotFoundException>()));
    await expectLater(silo.projects.list(), throwsA(isA<ConflictException>()));
    await expectLater(
      silo.projects.list(),
      throwsA(isA<SiloException>().having((caught) => caught.status, 'status', 502)),
    );
  });

  test('refuses a 2xx that is not the JSON the route promises', () async {
    stub.text('<html></html>');
    await expectLater(stub.silo().projects.list(), throwsA(isA<InvalidResponseException>()));
  });

  test('a deadline raises RequestTimeoutException', () async {
    stub.hang();
    await expectLater(
      stub.silo().projects.list(const RequestOptions(timeout: Duration(milliseconds: 10))),
      throwsA(isA<RequestTimeoutException>()),
    );
  });

  test('the client default deadline applies when a call sets none', () async {
    stub.hang();
    await expectLater(
      stub.silo(timeout: const Duration(milliseconds: 10)).projects.list(),
      throwsA(isA<RequestTimeoutException>()),
    );
  });

  test('a cancellation raises RequestAbortedException, before or during the call', () async {
    final cancelled = CancellationSignal()..cancel();
    await expectLater(
      stub.silo().projects.list(RequestOptions(cancellation: cancelled)),
      throwsA(isA<RequestAbortedException>()),
    );
    expect(stub.requests, isEmpty);

    stub.hang();
    final signal = CancellationSignal();
    final call = stub.silo().projects.list(RequestOptions(cancellation: signal));
    Timer.run(signal.cancel);
    await expectLater(call, throwsA(isA<RequestAbortedException>()));
  });

  test('a request that never lands raises NetworkException naming the cause', () async {
    stub.fail(http.ClientException('connection refused'));
    await expectLater(
      stub.silo().projects.list(),
      throwsA(isA<NetworkException>().having((caught) => '$caught', 'message', contains('connection refused'))),
    );
  });

  test('withKey keeps the server and swaps the key', () async {
    stub.json({'items': <Object?>[]});
    await stub.silo().withKey('other').projects.list();
    expect(stub.last.headers['authorization'], 'Bearer other');
    expect(stub.last.url.host, 'silo.test');
  });

  test('refuses an empty URL', () {
    expect(() => Silo(const SiloOptions(url: ' ')), throwsArgumentError);
  });
}
