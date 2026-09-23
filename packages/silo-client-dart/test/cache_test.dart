import 'package:clock/clock.dart';
import 'package:silo_client/silo_client.dart';
import 'package:test/test.dart';

import 'support/stub_http.dart';

void main() {
  late StubHttp stub;
  setUp(() => stub = StubHttp());

  CollectionHandle<Map<String, Object?>> posts(Silo silo, [String name = 'posts']) =>
      silo.scope('acme', 'prod').collection(name);

  const on = CacheOptions.on(ttl: Duration(seconds: 30), maxSize: 100);

  test('is off unless asked for', () async {
    stub
      ..json(row('01A'))
      ..json(row('01A'));
    final silo = stub.silo();
    await posts(silo).get('01A');
    await posts(silo).get('01A');
    expect(stub.requests, hasLength(2));
  });

  test('serves a repeated read from memory, keyed by the whole request', () async {
    stub
      ..json(row('01A'))
      ..json(row('01A'))
      ..json(page([row('01A')]));
    final silo = stub.silo(cache: on);

    await posts(silo).get('01A');
    final cached = await posts(silo).get('01A');
    await posts(silo).get('01A', const EntryReadOptions.raw());
    await posts(silo).list();
    await posts(silo).list();

    expect(cached.id, '01A');
    expect(stub.requests, hasLength(3));
    final statistics = silo.cache.statistics;
    expect([statistics.hits, statistics.misses, statistics.size], [2, 3, 3]);
    expect(statistics.hitRate, 0.4);
  });

  test('a write drops its collection and leaves a sibling alone', () async {
    stub
      ..json(row('01A'))
      ..json(row('01B'))
      ..empty()
      ..json(row('01A'));
    final silo = stub.silo(cache: on);

    await posts(silo).get('01A');
    await posts(silo, 'posts-archive').get('01B');
    await posts(silo).delete('01A', 1);
    await posts(silo).get('01A');
    await posts(silo, 'posts-archive').get('01B');

    expect(stub.requests, hasLength(4));
  });

  test('a response expires after its ttl', () async {
    var now = DateTime.utc(2026, 9, 23);
    await withClock(Clock(() => now), () async {
      stub
        ..json(row('01A'))
        ..json(row('01A'));
      final silo = stub.silo(cache: on);

      await posts(silo).get('01A');
      now = now.add(const Duration(seconds: 31));
      await posts(silo).get('01A');

      expect(stub.requests, hasLength(2));
      expect(silo.cache.statistics.evictions, 1);
    });
  });

  test('holds at most maxSize responses per ttl and bound', () async {
    stub
      ..json(row('01A'))
      ..json(row('01B'))
      ..json(row('01A'));
    final silo = stub.silo(cache: const CacheOptions.on(ttl: Duration(seconds: 30), maxSize: 1));

    await posts(silo).get('01A');
    await posts(silo).get('01B');
    await posts(silo).get('01A');

    expect(stub.requests, hasLength(3));
  });

  test('refuses to guess a ttl or a bound', () async {
    await expectLater(posts(stub.silo(cache: const CacheOptions.on())).get('01A'), throwsStateError);
  });

  test('clear empties the cache and keeps the counters; withKey starts empty', () async {
    stub
      ..json(row('01A'))
      ..json(row('01A'))
      ..json(row('01A'));
    final silo = stub.silo(cache: on);

    await posts(silo).get('01A');
    await posts(silo.withKey('other')).get('01A');
    silo.cache.clear();
    await posts(silo).get('01A');

    expect(stub.requests, hasLength(3));
    expect(silo.cache.statistics.misses, 2);
  });
}
