import 'package:silo_client/silo_client.dart';
import 'package:test/test.dart';

import 'support/stub_http.dart';

Map<String, Object?> receipt({String id = '01T', String kind = 'entry', Object? blockedBy}) => {
  'id': id,
  'kind': kind,
  'origin': {'project_id': 'p1', 'project_name': 'acme', 'env_id': 'e1', 'env_name': 'prod'},
  'subject_id': '01A',
  'subject_name': 'hello-world',
  'deleted_at': '2026-10-01T10:00:00Z',
  'deleted_by': {'kind': 'key', 'id': 'k1', 'label': 'editor'},
  'expires_at': null,
  'contents': {'collections': 0, 'entries': 1, 'assets': 0, 'bytes': 0},
  'media_refs': ['01M'],
  'state': 'parked',
  'restorable': blockedBy == null,
  'blocked_by': ?blockedBy,
};

void main() {
  late StubHttp stub;
  late Silo silo;
  setUp(() {
    stub = StubHttp();
    silo = stub.silo();
  });

  test('a delete answers its receipt id, and null when nothing was kept', () async {
    stub
      ..empty(headers: {'x-silo-trash-id': '01T'})
      ..json(asset())
      ..empty(headers: {'x-silo-trash-id': '01U'})
      ..empty();
    final posts = silo.scope('acme', 'prod').collection('posts');

    expect(await posts.delete('01A', 3), '01T');
    expect(await (await silo.media.get('01M')).delete(), '01U');
    expect(await posts.delete('01B', 1), isNull);
  });

  test('lists on the wire names, reads a receipt, and pages with the same filters', () async {
    stub
      ..json({
        'items': [
          receipt(kind: 'media_folder', blockedBy: {'kind': 'environment', 'name': 'prod', 'trash_id': '01E'}),
        ],
        'total': 3,
        'limit': 1,
        'offset': 0,
      })
      ..json({'items': <Object?>[], 'total': 3, 'limit': 1, 'offset': 1});

    final first = await silo.trash.list(
      TrashQuery(kind: TrashKind.mediaFolder, environment: 'prod', deletedAfter: DateTime.utc(2026, 10), limit: 1),
    );
    expect(stub.last.url.queryParameters, {
      'kind': 'media_folder',
      'env': 'prod',
      'deleted_after': '2026-10-01T00:00:00.000Z',
      'limit': '1',
      'offset': '0',
    });

    final item = first.items.single;
    expect(item.kind, TrashKind.mediaFolder);
    expect(item.origin.environmentName, 'prod');
    expect(item.deletedBy.label, 'editor');
    expect(item.deletedAt, DateTime.utc(2026, 10, 1, 10));
    expect(item.expiresAt, isNull);
    expect(item.contents.entries, 1);
    expect(item.state, TrashState.parked);
    expect(item.restorable, isFalse);
    expect(item.blockedBy?.kind, TrashKind.environment);
    expect(item.blockedBy?.trashId, '01E');

    await first.next();
    expect(stub.last.url.queryParameters, containsPair('kind', 'media_folder'));
    expect(stub.last.url.queryParameters, containsPair('offset', '1'));
  });

  test('reads what one receipt parked', () async {
    stub.json({
      'items': [
        {
          'trash_id': '01T',
          'kind': 'entry',
          'record': {'id': '01A'},
        },
      ],
      'total': 1,
    });
    final parked = await silo.trash.contents('01T', const TrashContentsQuery(limit: 25));

    expect(stub.last.url.path, '/api/trash/01T/items');
    expect(stub.last.url.query, 'limit=25');
    expect(parked.total, 1);
    expect(parked.records.single['kind'], 'entry');
  });

  test('a restore sends the rename and the chain, and reads what came back', () async {
    stub.json({
      'restored': ['01E', '01T'],
      'projects': 0,
      'environments': 1,
      'collections': 0,
      'entries': 1,
      'assets': 0,
      'broken_media_refs': ['01M'],
      'renamed_to': 'hello-world-2',
    });
    final result = await silo.trash.restore('01T', const TrashRestoreOptions(rename: 'hello-world-2', chain: true));

    expect(stub.last.method, 'POST');
    expect(stub.last.url.path, '/api/trash/01T/restore');
    expect(stub.lastBody, {'rename': 'hello-world-2', 'chain': true});
    expect(result.restored, ['01E', '01T']);
    expect(result.brokenMediaRefs, ['01M']);
    expect(result.renamedTo, 'hello-world-2');
  });

  test('purges one receipt, and empties with the confirmation word', () async {
    stub
      ..empty()
      ..json({'purged': 4});

    await silo.trash.purge('01T');
    expect(stub.last.method, 'DELETE');
    expect(stub.last.url.path, '/api/trash/01T');

    expect(await silo.trash.empty(), 4);
    expect(stub.last.url.path, '/api/trash/purge');
    expect(stub.lastBody, {'confirm': 'empty'});
  });
}
