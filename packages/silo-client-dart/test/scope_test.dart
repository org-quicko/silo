import 'package:silo_client/silo_client.dart';
import 'package:test/test.dart';

import 'support/stub_http.dart';

void main() {
  late StubHttp stub;
  late Silo silo;
  setUp(() {
    stub = StubHttp();
    silo = stub.silo();
  });

  test('a rename preview binds the real call to the record it described', () async {
    final report = {
      'id': '01P',
      'from': 'acme',
      'to': 'acme-corp',
      'rewritten_claims': ['entries:read:acme/*'],
      'pattern_affected_claims': <String>[],
    };
    stub
      ..json(report)
      ..json(report);

    final preview = await silo.project('acme').rename('acme-corp', const RenameOptions(dryRun: true));
    expect(stub.last.url.query, 'dry_run=true');
    expect(stub.lastBody, {'name': 'acme-corp'});
    expect(preview.rewrittenClaims, ['entries:read:acme/*']);

    await silo.project('acme').rename('acme-corp', RenameOptions(expectedId: preview.id));
    expect(stub.last.url.query, 'expected_id=01P');
  });

  test('delete sends force only when asked', () async {
    stub
      ..empty()
      ..empty();
    await silo.scope('acme', 'staging').delete();
    expect(stub.last.url.query, isEmpty);
    await silo.scope('acme', 'staging').delete(const DeleteOptions(force: true));
    expect(stub.last.url.toString(), 'http://silo.test/api/projects/acme/envs/staging?force=true');
  });

  test('maps collection summaries and creates with the schema as given', () async {
    stub
      ..json({
        'items': [
          {
            'id': '01C',
            'name': 'posts',
            'entries': 3,
            'requires_auth': true,
            'created_at': '2026-09-01T10:00:00Z',
            'updated_at': '2026-09-02T10:00:00+05:30',
          },
        ],
      })
      ..json({
        'id': '01C',
        'name': 'posts',
        'schema': {'type': 'object'},
      });

    final summary = (await silo.scope('acme', 'prod').collections.list()).single;
    expect(summary.requiresAuth, isTrue);
    expect(summary.updatedAt, DateTime.utc(2026, 9, 2, 4, 30));

    final definition = await silo.scope('acme', 'prod').collections.create('posts', {'type': 'object'});
    expect(stub.lastBody, {
      'name': 'posts',
      'schema': {'type': 'object'},
    });
    expect(definition.schema, {'type': 'object'});
  });

  test('declares a variable per project and values it per environment', () async {
    final view = {
      'name': 'API_URL',
      'description': 'public API',
      'value': null,
      'set_in': 0,
      'created_at': '2026-09-01T10:00:00Z',
      'updated_at': '2026-09-01T10:00:00Z',
    };
    stub
      ..json(view)
      ..json(view);

    await silo
        .project('acme')
        .variables
        .declare(
          'API_URL',
          const DeclareVariableOptions(description: 'public API', environment: 'prod', value: 'https://api'),
        );
    expect(stub.last.url.query, 'env=prod');
    expect(stub.lastBody, {'name': 'API_URL', 'description': 'public API', 'value': 'https://api'});

    final unset = await silo.scope('acme', 'staging').variables.unset('API_URL');
    expect(stub.last.method, 'DELETE');
    expect(unset.value, isNull);
  });
}
