import 'package:silo_client/silo_client.dart';
import 'package:test/test.dart';

import 'support/stub_http.dart';

void main() {
  late StubHttp stub;
  late EnvironmentHandle prod;
  setUp(() {
    stub = StubHttp();
    prod = stub.silo().scope('acme', 'prod');
  });

  test('splits the envelope off and renames nothing else', () async {
    stub.json(row('01A', rev: 4, fields: {'product_code': 'X1', 'id_hint': 'kept'}));
    final entry = await prod.collection('posts').get('01A');

    expect(stub.last.url.path, '/api/projects/acme/envs/prod/collections/posts/01A');
    expect(stub.last.url.query, isEmpty);
    expect(entry.id, '01A');
    expect(entry.rev, 4);
    expect(entry.updatedAt, DateTime.utc(2026, 9, 2, 10));
    expect(entry.fields, {'product_code': 'X1', 'id_hint': 'kept'});
  });

  test('reads raw templates when asked', () async {
    stub.json(row('01A'));
    await prod.collection('posts').get('01A', const EntryReadOptions.raw());
    expect(stub.last.url.queryParameters, {'variables': 'raw'});
  });

  test('a converter types the fields both ways, and writes send raw and the revision', () async {
    final posts = prod.collection('posts').withConverter(fromJson: Post.fromJson, toJson: (post) => post.toJson());
    stub
      ..json(row('01A', fields: {'title': 'Hello', 'status': 'draft'}))
      ..json(row('01A', rev: 2, fields: {'title': 'Hello', 'status': 'published'}))
      ..empty();

    final created = await posts.create(const Post('Hello', 'draft'));
    expect(stub.last.method, 'POST');
    expect(stub.last.url.queryParameters, {'variables': 'raw'});
    expect(stub.lastBody, {'title': 'Hello', 'status': 'draft'});

    final replaced = await posts.replace(created.id, created.rev, const Post('Hello', 'published'));
    expect(stub.last.method, 'PUT');
    expect(stub.last.url.query, 'rev=1&variables=raw');
    expect(replaced.fields.status, 'published');

    await posts.delete(replaced.id, replaced.rev);
    expect(stub.last.method, 'DELETE');
    expect(stub.last.url.query, 'rev=2');
  });

  test('sends the filter as JSON and the sort as its string, in the order set', () async {
    stub.json(page([]));
    await prod
        .collection('posts')
        .list(
          EntryListQuery(where: Filter.field('status').equals('published'), sort: Sort.recentlyUpdated(), limit: 20),
        );

    expect(
      stub.last.url.query,
      'limit=20&filter=${Uri.encodeComponent('{"op":"eq","path":"\$.data.status","value":"published"}')}'
      '&sort=-%24.updated_at',
    );
  });

  test('navigates by the window the server answered, not the one asked for', () async {
    stub
      ..json(page([row('01A')], total: 1200, limit: 500))
      ..json(page([row('01B')], total: 1200, limit: 500, offset: 500));

    final first = await prod.collection('posts').list(const EntryListQuery(limit: 900));
    expect(first.pageCount, 3);
    expect(first.hasMore, isTrue);

    final second = await first.next();
    expect(stub.last.url.queryParameters, {'limit': '500', 'offset': '500'});
    expect(second!.entries.single.id, '01B');
    expect(second.pageNumber, 2);
  });

  test('all() pages lazily and stops on the first short page', () async {
    stub
      ..json(page([row('01A'), row('01B')], total: 3, limit: 2))
      ..json(page([row('01C')], total: 3, limit: 2, offset: 2));

    final ids = await prod.collection('posts').all(const EntryListQuery(limit: 2)).map((entry) => entry.id).toList();

    expect(ids, ['01A', '01B', '01C']);
    expect(stub.requests, hasLength(2));
  });

  test('pages() yields whole pages', () async {
    stub
      ..json(page([row('01A'), row('01B')], total: 3, limit: 2))
      ..json(page([row('01C')], total: 3, limit: 2, offset: 2));

    final sizes = await prod
        .collection('posts')
        .pages(const EntryListQuery(limit: 2))
        .map((page) => page.length)
        .toList();
    expect(sizes, [2, 1]);
  });

  test('a cancelled stream stops before the next page', () async {
    final signal = CancellationSignal()..cancel();
    await expectLater(
      prod.collection('posts').all(const EntryListQuery(), EntryReadOptions(cancellation: signal)).toList(),
      throwsA(isA<RequestAbortedException>()),
    );
    expect(stub.requests, isEmpty);
  });
}
