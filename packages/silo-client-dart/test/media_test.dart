import 'dart:convert';

import 'package:silo_client/silo_client.dart';
import 'package:test/test.dart';

import 'support/stub_http.dart';

Map<String, Object?> asset({String filename = 'logo.png', String hash = 'h1'}) => {
  'id': '01M',
  'filename': filename,
  'folder': 'brand',
  'blob_key': 'media/01M',
  'size': 3,
  'content_type': 'image/png',
  'hash': hash,
  'state': 'active',
  'tags': ['brand'],
  'url': '/media/01M',
  'created_at': '2026-09-01T10:00:00Z',
  'updated_at': '2026-09-01T10:00:00Z',
};

void main() {
  late StubHttp stub;
  late Media media;
  setUp(() {
    stub = StubHttp();
    media = stub.silo().media;
  });

  test('uploads a multipart file with its folder', () async {
    stub.json(asset());
    final logo = await media.upload(const MediaUpload(bytes: [1, 2, 3], filename: 'logo.png', folder: 'brand'));

    expect(stub.last.headers['content-type'], startsWith('multipart/form-data'));
    final body = latin1.decode(stub.last.bodyBytes);
    expect(body, contains('filename="logo.png"'));
    expect(body, contains('name="folder"'));
    expect(logo.reference, 'silo://media/01M');
    expect(logo.state, MediaState.active);
  });

  test('refuses an upload with no filename before sending it', () async {
    expect(() => media.upload(const MediaUpload(bytes: [1], filename: '')), throwsArgumentError);
    expect(stub.requests, isEmpty);
  });

  test('a mutating call adopts the answer in place', () async {
    stub
      ..json(asset())
      ..json(asset(filename: 'logo-2026.png'))
      ..json(asset(filename: 'logo-2026.png', hash: 'h2'));
    final logo = await media.get('01M');

    final renamed = await logo.rename('logo-2026.png');
    expect(identical(renamed, logo), isTrue);
    expect(logo.filename, 'logo-2026.png');

    await logo.replace(const MediaReplace(bytes: [9], filename: 'logo-2026.png'));
    expect(stub.last.url.path, '/api/media/01M/content');
    expect(logo.hash, 'h2');
  });

  test('a refused delete carries the referrers', () async {
    stub
      ..json(asset())
      ..json({
        'error': {
          'code': 'media_in_use',
          'message': 'in use',
          'details': {
            'usage_count': 3,
            'visible_count': 1,
            'visible_capped': false,
            'referrers': [
              {'media_id': '01M', 'project': 'acme', 'env': 'prod', 'collection': 'posts', 'entry_id': '01A'},
            ],
          },
        },
      }, status: 409);
    final logo = await media.get('01M');

    await expectLater(
      logo.delete(),
      throwsA(
        isA<MediaInUseException>()
            .having((caught) => caught.usageCount, 'usageCount', 3)
            .having((caught) => caught.referrers.single.environment, 'environment', 'prod'),
      ),
    );
  });

  test('a bulk delete answers a report and caps itself at 100 ids', () async {
    stub.json({
      'deleted': ['01A'],
      'failed': [
        {'id': '01B', 'code': 'not_found', 'message': 'gone'},
      ],
    });
    final report = await media.deleteMany(['01A', '01B']);
    expect(stub.lastBody, {
      'ids': ['01A', '01B'],
      'force': false,
    });
    expect(report.failed.single.usageCount, isNull);

    expect(() => media.deleteMany(List.filled(101, 'x')), throwsArgumentError);
  });

  test('usages page by what the key may see', () async {
    stub
      ..json(asset())
      ..json({'items': <Object?>[], 'total': 120, 'visible': 30, 'visible_capped': false});
    final usages = await (await media.get('01M')).usages(const MediaUsageQuery(limit: 10));

    expect(usages.total, 120);
    expect(usages.pageCount, 3);
  });

  test('translates a query onto the wire names', () async {
    stub.json({'items': <Object?>[], 'total': 0, 'limit': 50, 'offset': 0});
    await media.list(MediaQuery(text: 'logo', extension: 'png', modifiedAfter: DateTime.utc(2026, 9)));
    expect(stub.last.url.queryParameters, {
      'q': 'logo',
      'ext': 'png',
      'modified_after': '2026-09-01T00:00:00.000Z',
      'limit': '50',
      'offset': '0',
    });
  });

  test('a folder travels in the query when it is deleted', () async {
    stub.empty();
    await media.folders.delete('brand/old', const MediaFolderDeleteOptions(recursive: true));
    expect(stub.last.url.query, 'path=brand%2Fold&recursive=true');
  });

  test('recognises only the scheme form of a reference', () {
    expect(MediaReference.idOf('silo://media/01M?x#y'), '01M');
    expect(MediaReference.idOf('/media/01M'), isNull);
  });
}
