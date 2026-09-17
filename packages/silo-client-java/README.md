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

## Getting started

The whole shape of the client in one screen: reach an instance, define a
collection, write an entry, read it back.

```java
import in.org.quicko.silo.client.*;
import in.org.quicko.silo.client.collections.*;
import in.org.quicko.silo.client.entries.*;
import in.org.quicko.silo.client.scope.*;

public record Post(String title, String status, List<String> tags) {}

Silo silo = Silo.at("https://silo.example.com", System.getenv("SILO_KEY"));

// The instance is reachable, and this route needs no key.
System.out.println(silo.health().version());

// A scope is a project and an environment, always both by name.
EnvironmentHandle prod = silo.scope("acme", "prod");

// A collection is its JSON Schema. silo validates every write against it.
prod.collections().create("posts", JsonSchema.parse("""
    {
      "type": "object",
      "required": ["title", "status"],
      "properties": {
        "title":  { "type": "string" },
        "status": { "type": "string", "enum": ["draft", "published"] },
        "tags":   { "type": "array", "items": { "type": "string" } }
      }
    }
    """));

CollectionHandle<Post> posts = prod.collection("posts", Post.class);

Entry<Post> created = posts.create(new Post("Hello", "draft", List.of("intro")));

Entry<Post> published = posts.replace(
    created.id(),
    created.rev(),
    new Post("Hello", "published", List.of("intro")));

for (Entry<Post> post : posts.all()) {
  System.out.printf("%s  %s%n", post.id(), post.fields().title());
}

posts.delete(published.id(), published.rev());
```

A record works as the field type, and so does a plain class with public fields
or getters and setters. Jackson reads it, so whatever Jackson can bind, this
client can carry.

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

## Projects and environments

```java
List<Project> projects = silo.projects().list();
Project acme = silo.projects().create("acme");

ProjectHandle project = silo.project("acme");
List<Environment> environments = project.environments().list();
project.environments().create("staging");
```

All three of projects, environments and collections are ULID-keyed records, so
all three can be renamed. A rename rewrites the claims that name the old scope,
which is why it is worth previewing first:

```java
RenameReport preview = project.rename("acme-corp", RenameOptions.preview());

preview.rewrittenClaims();        // claims silo will rewrite for you
preview.patternAffectedClaims();  // prefix patterns the rename moves across

// Bind the real call to the record the preview described.
project.rename("acme-corp", RenameOptions.none().expectedId(preview.id()));
```

`expectedId` is what stops the rename landing on a different record that took
the name in between. Note that `project` still addresses `acme` afterwards:
handles are immutable, so build a new one.

Deleting a project or environment that still holds content is refused unless
you say otherwise:

```java
silo.project("acme").environment("staging").delete(DeleteOptions.forced());
```

## Collections and schemas

```java
EnvironmentHandle prod = silo.scope("acme", "prod");

List<CollectionSummary> summaries = prod.collections().list();
for (CollectionSummary summary : summaries) {
  System.out.printf("%s  %d entries%n", summary.name(), summary.entries());
}
```

The listing carries no schemas, because a list of collections never draws one.
Ask for a schema when you need it, or for all of them at once:

```java
CollectionDefinition definition = prod.collection("posts").schema().get();
List<CollectionDefinition> everySchema = prod.schemas();
```

A schema read is bundled, so the `silo://` refs inside it are already resolved
and the document renders on its own. Updating one is a `put`:

```java
prod.collection("posts").schema().put(JsonSchema.parse(updatedDocument));
```

Deleting the schema deletes the collection. That is the only path the server
exposes for it, which is why it lives here rather than on the handle:

```java
prod.collection("posts").schema().delete(DeleteOptions.forced());
```

## Variables

A variable is declared once per project and valued per environment. Every
`{{NAME}}` in an entry is substituted on the way out.

```java
// Declared for the project, with an initial value in one environment.
silo.project("acme").variables().declare("API_URL",
    DeclareVariableOptions.none()
        .description("Where the public API lives")
        .environment("prod")
        .value("https://api.acme.com"));

// Valued per environment.
silo.scope("acme", "staging").variables().set("API_URL", "https://api.staging.acme.com");

for (Variable variable : silo.scope("acme", "prod").variables().list()) {
  System.out.printf("%s = %s%n", variable.name(), variable.value().orElse("(unset)"));
}
```

`value()` is an `Optional` on purpose. Empty means this environment has set
nothing, and the reference is left standing in the response rather than blanked.
An empty string is a value somebody chose, and substitutes as empty.

```java
silo.scope("acme", "staging").variables().unset("API_URL"); // the name survives
silo.project("acme").variables().undeclare("API_URL");      // the name does not
```

## Search

```java
SearchPage page = silo.search(SearchQuery.matching("release notes").limit(20));

for (SearchHit hit : page.hits()) {
  System.out.printf("%s/%s/%s %s%n",
      hit.project(), hit.environment(), hit.collection(), hit.entry().id());
  hit.snippets().forEach(snippet ->
      System.out.println("  " + snippet.before() + "[" + snippet.match() + "]" + snippet.after()));
}
```

The reach is whatever you call `search` on, never an argument, so it cannot be
widened by forgetting one:

```java
silo.search(query);                                       // everything the key can read
silo.scope("acme", "prod").search(query);                 // one environment
silo.scope("acme", "prod").collection("posts").search(query); // one collection
```

A search can be filter-only, and it can be truncated. The portable scan engine
stops at a visit cap, and when it does `total` counts what was examined rather
than what exists:

```java
if (page.truncated()) {
  // pageCount() is empty here: the total is a scan's count, not a real one.
  System.out.println("partial results from the " + page.engine() + " engine");
}
```

## Media

The library is instance-global, so it hangs off the client rather than off a
scope.

```java
MediaAsset logo = silo.media().upload(
    MediaUpload.of(Path.of("logo.png")).folder("brand"));

post.heroImage = logo.reference();   // silo://media/<id>, never logo.url()
```

Store the reference in an entry, not the URL. A rename or a move keeps the
reference and can change the URL, so a stored URL is the thing a later rename
silently breaks.

`silo.media()` is how you find or add an asset. `MediaAsset` is what you do to
one that already exists, and each of these adopts the server's answer in place:

```java
MediaAsset asset = silo.media().get(id);

asset.rename("logo-2026.png");
asset.moveTo("brand/archive");
asset.setTags(List.of("brand", "archived"));  // replaces the list, does not append
```

Replacing the bytes keeps the id, the reference, the URL and the filename, so
every entry that points at it shows the new file without any of them being
rewritten. The extension has to stay the same:

```java
asset.replace(MediaReplace.of(Path.of("logo-v2.png")));
asset.hash();         // re-read from the server's answer
asset.sizeInBytes();  // so has this
```

Listing takes a query, and pages lazily like entries do:

```java
MediaPage page = silo.media().list(MediaQuery.all()
    .folder("brand")
    .recursive(true)
    .extension("png")
    .modifiedAfter(Instant.now().minus(Duration.ofDays(30))));

for (MediaAsset file : silo.media().all(MediaQuery.all().text("logo"))) {
  System.out.println(file.filename());
}

List<String> extensions = silo.media().extensions();  // what is actually in there
```

Folders are explicit records, so one can exist before anything is filed into it:

```java
MediaFolders folders = silo.media().folders();

folders.create("brand/2026");
folders.rename("brand/2026", "brand/current", MediaFolderMoveOptions.merging());
folders.delete("brand/archive", MediaFolderDeleteOptions.recursively().force(true));
```

Deleting an asset an entry still references is refused. The refusal carries the
facts you need to decide what to do:

```java
try {
  asset.delete();
} catch (MediaInUseException caught) {
  caught.usageCount();     // every referrer, readable by this key or not
  caught.visibleCount();   // how many of them this key may see
  caught.visibleCapped();  // the server stopped counting before it ran out
  caught.referrers().forEach(usage ->
      System.out.printf("%s/%s/%s %s%n",
          usage.project(), usage.environment(), usage.collection(), usage.entryId()));
}
```

Or ask first, which pages by what this key may see rather than by the true total:

```java
MediaUsagePage usages = asset.usages();
usages.total();    // the true referrer count
usages.visible();  // what this key is allowed to see
```

A bulk delete always answers a report rather than throwing, so a partial
success is a value:

```java
MediaDeleteReport report = silo.media().deleteMany(ids);
report.deleted();
report.failed().forEach(failure ->
    System.out.printf("%s: %s (%s)%n", failure.id(), failure.message(), failure.code()));
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

```java
try {
  posts.replace(id, rev, fields);
} catch (ValidationFailedException caught) {
  caught.details().forEach(detail ->
      System.out.printf("%s %s%n", detail.path(), detail.message()));
} catch (ConflictException caught) {
  // Somebody wrote between your read and this call. Re-read and decide.
  Entry<Post> current = posts.get(id);
} catch (ForbiddenException caught) {
  // The key is valid and does not hold the claim this call needs.
  log.warn("{} {} needs a claim this key lacks", caught.method(), caught.path());
} catch (NetworkException caught) {
  // The request never landed. That is not evidence about what the server did.
  log.error("could not reach silo; reconcile before retrying", caught);
}
```

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

## Caching reads

```java
Silo silo = new Silo(SiloOptions.of(url, key).cache(CacheOptions.on()));

CollectionHandle<Post> posts = silo.scope("acme", "prod").collection("posts", Post.class);
posts.get("01ABC");   // reaches the server
posts.get("01ABC");   // served from the cache

posts.replace("01ABC", 3, edited);  // drops what it made stale
posts.get("01ABC");                 // reaches the server again

silo.cache().clear();                 // after a write made somewhere else
silo.cache().statistics().hitRate();
```

**Off unless you ask for it.** A cached read hands back the `rev` it was stored
with, and a write carrying a stale one fails with `ConflictException` — so this
is a decision the caller makes, for the same reason there is no default project
or environment.

### What is cached, and for how long

| Read | Holds | ttl | Bound |
|------|-------|-----|-------|
| `get` | one entry, by id | 30s | 1024 |
| `list` | one page of entries | 15s | 256 |

`all()` and `pages()` page through `list()`, so they are held with it. Nothing
else is cached — a schema, a search, a variable and a media listing all reach
the server every time.

### Setting the numbers

Two places can name a ttl and a bound, and **`@Cache` wins**:

```java
@Cache(ttl = 30, maxSize = 1024)        // on the read — ttl in seconds
public Entry<F> get(String id, EntryReadOptions options) { ... }
```

```java
CacheOptions.on(Duration.ofMinutes(5), 10_000)    // under every read

CacheOptions.on()
    .ttl(Duration.ofMinutes(5))
    .maxSize(10_000);
```

A read states what it knows about its own staleness; `CacheOptions` is the
baseline beneath it. Either number may be left out on either side, and what is
left out on the read is taken from the options:

| `@Cache` on the read | `CacheOptions` | In force |
|----------------------|----------------|----------|
| `@Cache(ttl = 30, maxSize = 1024)` | anything | 30s, 1024 |
| `@Cache(ttl = 30)` | `.maxSize(10_000)` | 30s, 10 000 |
| `@Cache` | `.on(ttl, maxSize)` | both from the options |
| `@Cache` | `.on()` | refused — no number to use |

The last row raises rather than picking a default, because a ttl this library
invented is one you did not choose. The reads above ship with both numbers set,
so changing `CacheOptions` alone will not move them — edit the annotation, or
leave it bare and drive everything from `SiloOptions`.

`@Cache` is required even when it carries nothing: it is what marks a read
cacheable, and a read that calls for the cache without one raises at the first
call rather than quietly not caching.

### The cache key

The key is the request: **the method, the path and every query parameter**, the
way a CDN composes one. `Transport` is the only layer that sees a built request,
and a key made of a method's arguments could not tell `01ABC` in `acme/prod`
from `01ABC` in `beta/staging` — the path carries the project, the environment
and the collection, and the arguments do not.

Taking every parameter is what makes a raw read and a resolved read of one entry
two entries, and two windows of one filter two more. Parameters are sorted into
the key, so two callers who built one read in a different order still meet one
entry, and values are percent-encoded so a filter holding an `&` cannot forge
the key of a read carrying one more parameter.

### Invalidation

Every write this client makes to a collection drops that collection's rows and
pages — the path stays the prefix of every key, so one sweep catches both. A
write made anywhere else is not something the client can be told about, which is
what the ttl is for, and `cache().clear()` when you know better.

A cache belongs to one client: `withKey` and `withUrl` start empty, because one
key's reads are not another key's to serve.
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
