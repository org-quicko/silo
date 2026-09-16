# silo-client (Java)

A typed, object-oriented Java client for [silo](../../README.md)'s HTTP API:
projects, environments, collections, schemas, entries, queries, variables,
search and media.

Two runtime dependencies, OkHttp and Jackson. Java 25 or newer. Every call
blocks, so run it on virtual threads.

```xml
<dependency>
  <groupId>in.org.quicko</groupId>
  <artifactId>silo-client</artifactId>
  <version>1.1.0</version>
</dependency>
```

The rationale for every decision here is in
[docs/design/java-client.md](../../docs/design/java-client.md). The
TypeScript client is [`packages/silo-client`](../silo-client), and the two are
held to the same route inventory by a test.

## The path is the object graph

```java
Silo silo = Silo.at("https://silo.example.com", System.getenv("SILO_KEY"));

CollectionHandle<Post> posts = silo.project("acme")
    .environment("prod")
    .collection("posts", Post.class);

Entry<Post> entry = posts.get("01J8ZK7Q2R");
System.out.println(entry.fields().title);
```

Handles are value objects and make no request, so nothing in a chain costs
anything until the call at the end. There is no default project or environment:
both names are always given, because a client that guessed would read the wrong
environment silently.

A handle is also immutable. After a rename it still addresses the old name and
its next call is a `NotFoundException`. Build a new handle for the new name.

## An entry is the envelope and your fields

```java
public class Post {
  public String title;
  public String status;
  public List<String> tags;
}
```

```java
Entry<Post> entry = posts.get(id);

entry.id();         // "01J8ZK7Q2R"
entry.rev();        // 4
entry.updatedAt();  // an Instant
entry.fields();     // your Post
```

The wire's row is flat: silo puts `id`, `rev`, `created_at` and `updated_at`
beside your own fields. Java cannot express a type that is both `Post` and an
envelope, so the client splits them and renames nothing on either side of that
line. Your `product_code` stays `product_code`.

Without a field type you get the map:

```java
Entry<Map<String, Object>> row = environment.collection("posts").get(id);
```

## Writes take the revision explicitly

```java
Entry<Post> created = posts.create(new Post("Hello", "draft", List.of()));

Entry<Post> replaced = posts.replace(created.id(), created.rev(), edited);

posts.delete(replaced.id(), replaced.rev());
```

`replace` is a full replace, which is what the route is: send every field. A
stale revision is a `ConflictException`; re-read and try again.

## Reading templates before editing them

Content can hold `{{NAME}}` references to environment variables, and a read
resolves them by default. An editor must not save a resolved value back over the
reference somebody typed, so it reads raw:

```java
Entry<Post> editable = posts.get(id, EntryReadOptions.raw());
```

Writes always send the stored text, whichever way the row was read.

## Filters are built

```java
EntryPage<Post> page = posts.list(EntryListQuery.all()
    .where(Filter.field("status").isEqualTo("published")
        .and(Filter.each("tags").isEqualTo("java")))
    .sort(Sort.recentlyUpdated())
    .limit(20));
```

`Filter.field` addresses your data, `Filter.meta` the envelope, and
`Filter.each` writes the array wildcard so nobody types it. The two spellings of
a wildcard predicate mean different things:

```java
Filter.each("tags").isNotEqualTo("x");        // some tag is not x
Filter.not(Filter.each("tags").isEqualTo("x")); // no tag is
```

Equality is `isEqualTo`, not `equals`: a one-argument `equals` would override
`Object.equals` rather than build a filter.

## Pagination follows the window the server answered

```java
for (Entry<Post> post : posts.all(EntryListQuery.all().limit(200))) {
  index(post);
}

EntryPage<Post> first = posts.list();
first.total();       // how many match
first.pageCount();   // an OptionalInt: empty on a truncated search
Optional<EntryPage<Post>> second = first.next();
```

silo clamps a limit over 500 and replaces a non-positive one, both silently, so
every page navigates by the window it was answered with and never by the one
that was asked for. `all()` and `pages()` page lazily and stop on the first
short page; `all().stream()` is the same rows as a `Stream`.

Offset iteration over data being written is not a snapshot.

## Media

```java
MediaAsset logo = silo.media().upload(
    MediaUpload.of(Path.of("logo.png")).folder("brand"));

post.heroImage = logo.reference();   // silo://media/<id>, never logo.url()
```

Store the reference in an entry, not the URL: a rename keeps the reference and
can change the URL. `MediaAsset` is what you do to an asset that already
exists: `rename`, `moveTo`, `setTags`, `replace`, `delete`, `usages`.
`silo.media()` is how you find or add one.

`deleteMany` always answers a report rather than throwing, so a partial success
is a value:

```java
MediaDeleteReport report = silo.media().deleteMany(ids);
report.failed().forEach(failure -> log.warn("{}: {}", failure.id(), failure.message()));
```

## Failures

`SiloException` is the base for everything silo answered and refused, with one
subclass per wire code, so you branch on a type rather than on a string:
`ValidationFailedException`, `UnauthorizedException`, `ForbiddenException`,
`NotFoundException`, `ConflictException`, `MediaInUseException`,
`MediaDeleteStalledException`, `InternalException`.

`NetworkException`, `RequestTimeoutException`, `RequestAbortedException` and
`InvalidResponseException` deliberately are **not** `SiloException`, because
nothing answered. All of them are unchecked.

Nothing is retried. A retried POST to a collection is a duplicate entry and a
retried 409 is wrong by definition, so retry policy belongs to the only layer
that knows whether a call was idempotent. A `NetworkException` on a write does
not prove the write failed: reconcile by re-reading.

## Deadlines and cancellation

```java
posts.list(EntryListQuery.all(), RequestOptions.within(Duration.ofSeconds(5)));

CancellationSignal signal = CancellationSignal.create();
executor.submit(() -> posts.all(query, EntryReadOptions.none().request(
    RequestOptions.until(signal))).toList());
signal.cancel();
```

A per-call deadline wins over the client's own. A deadline raises
`RequestTimeoutException` and a cancellation raises `RequestAbortedException`,
so the two are never confused.

## Bringing your own OkHttp and Jackson

```java
Silo silo = new Silo(SiloOptions.of(url, key)
    .httpClient(myOkHttp)          // interceptors, proxies, your own pool
    .objectMapper(myObjectMapper)  // the modules your field types need
    .timeout(Duration.ofSeconds(10))
    .headers(Map.of("X-Trace-Id", traceId)));
```

## What this client does not reach

Keys, claims, plugins, transfer, settings, audit, observability, search reindex,
media purge and media reconcile. Each is an operator action reachable from the
admin UI and the CLI, and none of it is content.

There is no generic `request()` escape hatch either, so a route the client does
not cover is a client change. `RouteInventory` lists every route it reaches and
every route it leaves out, and a test holds the two lists to the TypeScript
client's.

The `transport` package is internal. It is public in the Java sense because the
other packages need it, and nothing in it is part of the supported surface.

## Building

```bash
mvn test
mvn -Prelease package
```

Sources and javadoc attach under the `release` profile, which keeps two plugins
out of an ordinary test run.
