# Java client

> Part of silo's design spec. The decisions log (D1–…) that governs it
> lives in [IMPLEMENTATION.md](../../IMPLEMENTATION.md).

## 15. The Java client (D69)

`packages/silo-client-java`, published to Maven Central as
`in.org.quicko.silo:client`. The same surface §14 describes, for the data half
of the API: projects, environments, collections, schemas, entries, queries,
variables, search and media. Java 25, OkHttp and Jackson, and nothing else.

It is flat under `packages/` because §14 said the second language client would
be, and because the Bun workspace globs `packages/*` — a directory with no
`package.json` is not a member, so a Maven project sits there without being
installed, linked or typechecked by anything on the TypeScript side.

### 15.1 What is deliberately the same

The object graph, the immutable handles, the absent default scope, the
pass-the-revision writes, the per-call raw/resolved choice, the window-driven
pagination, the built filters, the four kinds of failure, the explicit
per-type mappers and `RouteInventory`. Each of those is a decision §14 argues
for, none of the arguments is about TypeScript, and a consumer who has read one
client should not have to re-learn the other.

`RouteInventoryDriftTest` is what keeps that honest for the one part a reader
can check mechanically: it parses
`packages/silo-client/src/transport/route-inventory.ts` and asserts the covered
set and the out-of-scope keys match this client's, skipping when the TypeScript
package is not checked out beside it. That inventory is itself checked against
the server's own registrations, so the Java list inherits the guarantee rather
than restating it. The reasons are prose and may differ; the route strings are
the contract.

### 15.2 An entry is split, because Java cannot express the intersection

§14.2's decision is that a read answers the wire's own flat row: the author's
fields and the envelope's four keys in one object, nothing renamed or nested.
That rests on TypeScript's `Fields & EntryEnvelope`, and Java has no way to say
it. A type is either the caller's `Post` or it is not.

Three shapes were available. A `Post` that extends a client-supplied
`EntryEnvelope` base class would be genuinely flat and would deserialise
straight from the wire, at the price of every domain type in the consumer's
codebase inheriting from this library: no records, no reuse of a class that
already exists, no two collections sharing a DTO. A row as
`Map<String, Object>` with envelope accessors is flat and keeps every type out
of it, and gives up the typing that is most of §14.5's point. `Entry<F>`
holding the envelope beside `fields()` gives up flatness and nothing else.

So `Entry<F>` is a record of `id`, `rev`, `createdAt`, `updatedAt` and
`fields`, and `EntryMapper` is the one place that splits the row. What §14.2
was actually protecting survives intact: the row carries no transport, no scope
and no methods, so it cannot leak an API key into a log line the way D62's
active record did, it is immutable, and it drops into a cache or a DTO as-is.
What is given up is handing a row straight back to the call it came from, and
the write signature already made that unnecessary, since
`posts.replace(id, rev, fields)` names the three things it sends.

The timestamps are `Instant` rather than the wire's strings, which §14.2 kept
deliberately. That decision does not carry, because it was bought with
flatness: a row going back out unchanged had to keep the spelling and the type
it arrived with. This row never goes back out whole, so the only remaining
question is which type a caller would rather hold, and in Java that is
`Instant`. `Timestamps` accepts an explicit offset as well as the `Z` form silo
writes, because losing a field is worse than parsing one.

Nothing else is renamed. `EntryMapper` strips exactly the four envelope keys
and copies every other key across untouched, and a test asserts that a
`product_code` arrives as `product_code`.

### 15.3 Blocking, because Java 25 already solved the other half

Every call blocks. OkHttp offers `enqueue`, a `CompletableFuture` surface would
be mechanical to add, and adding it would double the method count of every
class in this client for a concurrency model the platform now provides
underneath: on a virtual thread a blocking call costs a continuation rather
than a thread, so a caller who wants a thousand concurrent reads writes an
executor and not a different client.

The cost is real and worth naming. A caller on Java 21 or below, or inside a
framework that pins carrier threads, gets no parallelism from this client
without their own executor. That is a thread-pool line in their code, against a
second full API surface in this one.

`CancellationSignal` is what replaces `AbortSignal`. It holds a flag and a set
of cancel actions; `Transport` registers the in-flight OkHttp `Call` against it
and unregisters when the call settles, and a signal cancelled before a call is
made refuses the call rather than sending it. Telling the three failures apart
needs one ordering: OkHttp reports a cancelled call as an ordinary
`IOException`, indistinguishable by type from a host that was never reachable,
so the signal is consulted first, then the timeout exception types, then
`NetworkException`.

### 15.4 Where a Java name had to differ, and why

Every one of these is a collision, not a preference.

**`isEqualTo`, not `equals`.** `FilterField.equals(Object)` would override
`Object.equals` rather than build a filter, and the compiler would not say so.
`isNotEqualTo` follows it for symmetry.

**`CollectionCatalog`, not `Collections`.** `java.util.Collections` is imported
in a large share of Java files, and a second `Collections` on the classpath is
a name a reader has to disambiguate at every use.

**`RequestTimeoutException`, not `TimeoutException`.**
`java.util.concurrent.TimeoutException` has the other name, and a caller
catching both would be importing one and fully qualifying the other.

**`SiloException`, not `SiloError`.** `Error` means something specific in Java,
and it is not this.

**`RequestOptions.within`, `RenameOptions.preview`, `SearchQuery.matching`.**
A static factory and an instance method cannot share a signature, and these
three records want both a `timeout(Duration)`, a `dryRun()` and a
`text(String)` that read as builders and ones that read as accessors. The
accessor keeps the obvious name, since it is the one a reader meets in a
debugger.

Exceptions are unchecked throughout. A checked `SiloException` would put
`throws` on every signature in the client, and `Iterator.next` cannot declare
one at all, so the paging streams could not exist.

### 15.5 What is not typed, and what that costs

§14.5's `collection<Post>("posts").filter` types a filter to `keyof Post`, so
`filter.field("stauts")` does not compile. Java has no equivalent of a template
literal type over a type's own keys, and the shapes that approximate one —
generated field constants, an annotation processor, a `Post_` metamodel in the
JPA style — all require the consumer to generate code from their own DTOs,
which is a build-time dependency this client should not impose for one class of
typo.

So `Filter` is untyped and a misspelled field name is a filter that matches
nothing rather than a compile error. That is the behaviour the TypeScript
client's untyped `Filter` static already has, and the README states it rather
than leaving it to be discovered.

`JsonSchema` is likewise a tree rather than a typed model of the keywords. The
client validates nothing locally and hands a schema through exactly as given,
so a typed model here would be a second copy of a rule silo owns.

### 15.6 Verification without a socket

The tests run on an OkHttp application interceptor that records the request it
was handed and answers the next queued response, never opening a connection.
That is the same shape as the TypeScript package's recording stub fetch, and it
is what lets a test assert on the request the client actually built.

A local `HttpServer` was the first attempt and is the wrong tool twice over: it
adds a way for the suite to fail that has nothing to do with the client, and a
build host that refuses a loopback socket cannot run it at all. The interceptor
also makes the failure mapping directly testable, since it can throw the
`SocketTimeoutException` or `ConnectException` a runtime would.

One bug came out of that suite immediately, and it is the kind only a
wire-level assertion finds. `TransportRequest` froze its query map with
`Map.copyOf`, which answers an **unordered** map, so one call emitted
`?rev=3&variables=raw` and `?variables=raw&rev=3` on different runs. Nothing
functional depended on the order and everything human did: a cache key, a diff
of two access logs, a route grouped by URL. It holds a `LinkedHashMap` now.

There is no equivalent of §14.8's packed-tarball harness yet. The Java analogue
would consume the installed artifact from a throwaway project and check the
POM's published metadata, and Maven Central's own validation already covers
part of what `publint` and `attw` do for npm.

A `module-info.java` is also absent, and that is a deferral rather than a
decision. The descriptor was written — it exports every package but
`transport`, which is exactly the boundary §14's "no escape hatch" argument
wants stated — and `maven-compiler-plugin` reads module descriptors through
ASM, whose version in this build cannot read a Java 25 class file. Shipping an
unverified descriptor is worse than saying plainly that `transport` is public
in the Java sense because the other packages need it, and is not part of the
supported surface.

### 15.7 What the client deliberately does not reach

The same list as §14.9, for the same reasons: keys, claims, plugins, transfer,
settings, audit, observability, session introspection, search reindex, media
purge and media reconcile. There is no generic `request()` escape hatch, so a
route this client does not cover is a client change, which is the point of
`RouteInventory`.

The Java client also does not release with silo. Its `<version>` lives in a
`pom.xml` that `tools/set-version.ts` could not describe, and it goes out on a
`silo-client-java-v*` tag of its own, for the reason §14 gives the TypeScript
one: a library version is a compatibility promise to a consumer's build file,
not something `silo --version` prints.

The tag is decided and the workflow is not written. `release-silo-client.yml`
has no Java counterpart yet, so the first publish to Maven Central is by hand,
with `mvn -Prelease deploy`. What that workflow will need and npm's did not is
the signing half: Central requires a detached GPG signature on every artifact,
so it takes a key and a passphrase as secrets on top of the account token, and
the `release` profile is where the `maven-gpg-plugin` joins the sources and
javadoc jars it already attaches.

### 15.8 Caching, and why `@Cache` decorates rather than intercepts (D79)

A JVM consumer reading the same entry on every request pays a round trip for
each one, and the entry did not change between them. `@Cache` is how a read
says it may be served from memory, for how long, and what identifies one
response from another; Caffeine is what holds it, and `CacheOptions` is where a
consumer disagrees.

The name is Spring's `@Cacheable`, shortened, because that is the vocabulary a
Java consumer already has. **The mechanism is not Spring's**, and could not be.
Spring's annotation works because the container hands callers a proxy; there is
no container here, every handle is `final`, and none of them implements an
interface. Making the annotation work the way Spring's does meant one of three
things, and each cost more than it bought:

- **An interface per handle, proxied with `java.lang.reflect.Proxy`.** Roughly
  doubles the surface, and callers would hold `EntryReads<Post>` where §15.1
  promised them the same object graph the TypeScript client has.
- **Bytecode subclasses, with ByteBuddy.** Drops `final` from every handle,
  which §15.1's immutability leans on, and adds a bytecode-generation
  dependency to a client library. It also inherits Spring's own footgun: a
  call a class makes to itself never crosses the proxy, so `all()` calling
  `list()` would silently miss the cache.
- **A compile-time processor generating decorators.** No runtime magic, but it
  still needs something non-final to decorate, and adds a processor module plus
  a wiring step to a build that is otherwise `mvn test`.

So the annotation is read, not woven — and read **off the stack**, from the
method that asked. A read describes its request and calls `.cache()` with no
argument; `CachePolicy.declaredOnCaller` walks past the builder frame, finds the
read that called it, and takes the `@Cache` off exactly that method, matched on
its signature so one annotated overload cannot answer for another. The result is
remembered per method, so a call pays for a stack walk (about a microsecond) and
a map lookup, never for reflection — nothing next to the round trip it may save.

An earlier draft resolved the annotation into a `static final CachePolicy`
constant and passed that to `.cache(policy)`. It worked, but it named the method
three times — in the constant, in the annotation, and at the call — and only two
of the three were checked against each other. Deleting the `.cache(...)` call
left everything compiling and caching silently off, which is the failure this
client keeps refusing. Reading from the caller collapses all three into one:
**the annotation now decides whether caching happens at all**, and a read that
calls `.cache()` without declaring one raises immediately rather than quietly
doing nothing.

Only the immediate caller is consulted. A read that delegated its
request-building to a helper would raise rather than inherit whatever was
further up the stack, which is the one way this could have gone quietly wrong.
The cost that remains is real: `.cache()` no longer says where its numbers come
from, and a stack frame is now load-bearing. It is mitigated by the annotation
sitting on the same method, a few lines above the call, rather than at the top
of the class.

**The annotation declares the ttl and the bound; a consumer replaces them.**
This is a published client, so a number compiled into it is one a consumer
cannot change without forking — and equally, a read that knows its own staleness
should not have that overwritten by a blanket setting. Both elements are
therefore optional and the precedence runs **read first**: `@Cache` wins where
it states a number, `CacheOptions` supplies every number it leaves out, and
`inForce` is where the two meet. A number neither side names is refused, not
defaulted, because a ttl this library invented is one nobody chose.

`@Cache(ttl = 30, maxSize = 1024)` is the whole annotation, and the two numbers
are all of it. **Nothing names a cache** — not the annotation, not the policy,
not the key. A read needs a Caffeine instance of its own only because
`expireAfterWrite` and `maximumSize` are per-instance and neither is per-entry,
so the instances are looked up by the `CachePolicy` itself: the numbers are the
whole reason one exists. A name would have been a second identity for the same
thing, and the one an earlier draft carried was worse than redundant — it was a
string a caller could misspell into a tuning that silently never took effect.

### The key is composed from the request, the way a CDN composes one

The cache sits in `Transport`, which sees a built method, path and query and
never the caller's arguments — so Spring's `@Cacheable(key = "#id")` has nothing
to evaluate against here. That is a constraint, and it is also the right answer:
`#id` alone would serve `01ABC` of `acme/prod/posts` to a read of `01ABC` in
`beta/staging/posts`, because an id is only unique inside a scope the arguments
do not carry. The path does carry it.

So `CacheKey` takes all three, and every query parameter with them. There is no
policy to declare and nothing to leave out, which is the simplification that
matters most here: a parameter left out of a key is two different responses
sharing one entry, and no annotation can be relied on to stay right about that
as parameters are added.

`CacheKey.of` builds the key with `QueryString`, the same code that builds the
URL — so the key is the request rather than a second rendering of it that could
drift. What it adds is a sort, so two callers who set the same parameters
in a different order still meet one entry; `QueryString` itself stays
order-preserving, because on the wire the order is the caller's and nothing
depends on it. Percent-encoding comes for free and is not cosmetic: a filter
holding an `&` would otherwise render into a target indistinguishable from a
read carrying one more parameter. The path stays the prefix of whatever it
composes, which is what keeps prefix invalidation working — `matches` takes the
path itself, or the path followed by a `/` or a `?`, so a write to `posts`
cannot reach `posts-archive`.

**The cache lives under the read, not over it.** Keying on the built path and
query rather than on arguments is what makes a raw read and a resolved read of
one entry two entries in the cache, and two windows of one filter two more,
without the key having to know what `variables` or `offset` mean. It is also why
`all()` and `pages()` are cached without declaring anything: they page through
`list()`, and it is `list()` that reaches the server.

**Invalidation is declared by the write, for the same reason.** A write sets
`evicts` to the collection's path and `Transport` drops everything stored at or
below it on a successful response, so the transport never learns what an entry
is. The sweep is a walk of the stored keys rather than a keyed delete, because
the caller that replaced one row cannot name the pages that row appeared on. A
boundary check on the prefix is what keeps a write to `posts` off `posts-archive`.

**Only entries are cached, and only when asked.** Schemas, searches, variables
and media all reach the server every time; they were candidates, and each would
have been a second invalidation story for a read that is not on the hot path.
And the whole thing is off until `SiloOptions.cache` turns it on. A cached read
hands back the `rev` it was stored with, and a write carrying a stale one fails
with a `ConflictException` the caller did nothing to cause — which is the
failure §15.1's absent default scope exists to avoid, one layer down. A client
cannot be told about a write made somewhere else, so the ttl is the only bound
on staleness and `cache().clear()` is the escape hatch when the caller knows
better.

A cache belongs to one transport, so `withKey` and `withUrl` start empty: one
key's reads are not another key's to serve, and that is structural rather than a
component of the key.

This is not D7 revisited. That decision is about the server's storage layer,
where SQLite is the cache and no adapter interface exists; this is a client
holding a response it already fetched, on the other side of the wire.

Caffeine's `Ticker` is on `CacheOptions` for the reason `OkHttpClient` is on
`SiloOptions` — the alternative is a suite that sleeps for thirty seconds to
prove a ttl expires.
