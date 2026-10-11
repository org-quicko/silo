import 'package:silo_client/silo_client.dart';
import 'package:test/test.dart';

void main() {
  test('builds leaves against data, arrays and the envelope', () {
    expect(Filter.field('status').equals('published').toJson(), {
      'op': 'eq',
      'path': r'$.data.status',
      'value': 'published',
    });
    expect(Filter.each('tags').notEquals('x').toJson(), {'op': 'neq', 'path': r'$.data.tags[*]', 'value': 'x'});
    expect(Filter.meta('updated_at').atLeast('2026-01-01').toJson()['path'], r'$.updated_at');
    expect(Filter.field('year').oneOf([2016, 2017]).toJson()['value'], [2016, 2017]);
    expect(Filter.field('hero').exists().toJson(), {'op': 'exists', 'path': r'$.data.hero'});
  });

  test('groups without mutating what they combine', () {
    final published = Filter.field('status').equals('published');
    final combined = published.and(Filter.not(Filter.each('tags').equals('x')));

    expect(published.toJson()['op'], 'eq');
    expect(combined.toJson(), {
      'op': 'and',
      'args': [
        {'op': 'eq', 'path': r'$.data.status', 'value': 'published'},
        {
          'op': 'not',
          'args': [
            {'op': 'eq', 'path': r'$.data.tags[*]', 'value': 'x'},
          ],
        },
      ],
    });
  });

  test('sorts are the sort parameter\'s own strings', () {
    final title = Sort.by('title');

    expect(title, r'$.data.title');
    expect(title.descending(), r'-$.data.title');
    expect(title.descending().ascending(), r'$.data.title');
    expect(title.descending().direction, SortDirection.descending);
    expect(Sort.recentlyUpdated(), r'-$.updated_at');
    expect(Sort.of([Sort.by('year').descending(), title]), r'-$.data.year,$.data.title');
  });
}
