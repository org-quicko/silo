# silo_client (Dart)

The Dart client for [silo](../../README.md)'s HTTP API. It has the same surface
as the [TypeScript](../silo-client) and [Java](../silo-client-java) clients. It
runs on the Dart VM, Flutter and the web.

```yaml
dependencies:
  silo_client: ^1.0.0
```

## Start

```dart
import 'package:silo_client/silo_client.dart';

final silo = Silo.at('https://silo.example.com', key: key);

final posts = silo
    .scope('acme', 'prod')
    .collection('posts')
    .withConverter(fromJson: Post.fromJson, toJson: (post) => post.toJson());

final created = await posts.create(const Post(title: 'Hello', status: 'draft'));
final published = await posts.replace(created.id, created.rev, const Post(title: 'Hello', status: 'published'));

await for (final post in posts.all()) {
  print('${post.id} ${post.fields.title}');
}

await posts.delete(published.id, published.rev);
silo.close();
```

Handles send no request. There is no default project or environment.

## Where Dart differs

- An entry is `Entry<F>`: `id`, `rev`, `createdAt`, `updatedAt` and your
  `fields`. Dart has no intersection type, so the envelope sits beside your
  fields, as in Java. No field is renamed.
- `withConverter` types a collection. Without it, `fields` is a
  `Map<String, Object?>`. A `fromJson` from `json_serializable` or `freezed`
  works as is.
- `all()` and `pages()` are `Stream`s. They page lazily.
- `CancellationSignal` cancels a call. `RequestOptions(timeout: ...)` sets a
  deadline.
- Filters are untyped, as in Java. A misspelled field matches nothing.
- Errors are exceptions, as in Java: `NotFoundException`, `ConflictException`,
  `NetworkException`, `RequestTimeoutException`.

## Reads and filters

```dart
final editable = await posts.get(id, const EntryReadOptions.raw());

final page = await posts.list(EntryListQuery(
  where: Filter.field('status').equals('published').and(Filter.each('tags').equals('dart')),
  sort: Sort.recentlyUpdated(),
  limit: 20,
));
final next = await page.next();
```

`sort` takes a `SortTerm` or a raw string.

## Media

```dart
final logo = await silo.media.upload(MediaUpload(bytes: bytes, filename: 'logo.png', folder: 'brand'));
fields['hero'] = logo.reference; // silo://media/<id>. Do not store logo.url.
```

## Failures

```dart
try {
  await posts.replace(id, rev, fields);
} on ConflictException {
  // Somebody wrote first. Read again.
} on NetworkException {
  // The request did not land. Read again before you retry.
}
```

Nothing is retried.

## Caching

```dart
final silo = Silo(SiloOptions(
  url: url,
  key: key,
  cache: const CacheOptions.on(ttl: Duration(seconds: 30), maxSize: 1000),
));

silo.cache.statistics.hitRate;
silo.cache.clear();
```

The cache is off by default. Only `get` and `list` are cached. A write through
this client drops that collection. `withKey` and `withUrl` start empty.

## Your own HTTP client

`SiloOptions(httpClient: ...)` takes any `package:http` client. `close()` does
not close it.

## Build

```bash
dart pub get
dart test
```
