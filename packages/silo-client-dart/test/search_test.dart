import 'package:silo_client/silo_client.dart';
import 'package:test/test.dart';

import 'support/stub_http.dart';

void main() {
  test('a truncated scan has no page count and maps each hit', () async {
    final stub = StubHttp()
      ..json({
        'data': [
          {
            'project': 'acme',
            'env': 'prod',
            'collection': 'posts',
            'entry': row('01A', fields: {'title': 'Release notes'}),
            'snippets': [
              {'path': r'$.title', 'before': '', 'match': 'Release', 'after': ' notes'},
            ],
          },
        ],
        'total': 1,
        'limit': 1,
        'offset': 0,
        'truncated': true,
        'engine': 'scan',
      });

    final result = await stub.silo().scope('acme', 'prod').search(const SearchQuery(text: 'release', limit: 1));

    expect(stub.last.url.path, '/api/projects/acme/envs/prod/search');
    expect(stub.last.url.query, 'q=release&limit=1');
    expect(result.truncated, isTrue);
    expect(result.pageCount, isNull);
    expect(result.hasMore, isTrue);
    expect(result.engine, SearchEngine.scan);
    final hit = result.hits.single;
    expect(hit.environment, 'prod');
    expect(hit.entry.fields['title'], 'Release notes');
    expect(hit.snippets.single.match, 'Release');
  });
}
