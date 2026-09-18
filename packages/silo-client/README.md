# silo-client

The typed client for [silo](https://github.com/org-quicko/silo). It has the same
shape as silo itself: an instance holds projects, a project holds environments,
an environment holds collections, and a collection holds entries.

```sh
npm install @org-quicko/silo-client
```

Runs on Node 18+, Bun, Deno, browsers and workers.

The examples below build moviespace, a small film database.

## Start

```ts
import { Silo } from "@org-quicko/silo-client"

const silo = new Silo({ url: "http://localhost:8090", key: process.env.SILO_KEY })

const movies = silo.project("moviespace").environment("prod").collection("movies")

const page = await movies.list({ limit: 10 })
for (const movie of page.entries) {
  console.log(movie.title)
}
```

`silo.project("moviespace").environment("prod")` sends no request. It only
builds the path, so nothing needs an `await` until the read.

## Optional collection caching

```ts
const silo = new Silo({
  url: "http://localhost:8090",
  key: process.env.SILO_KEY,
  cache: { enabled: true, ttl: 10 * 60 * 1000, maxSize: 1_000 },
})

const statistics = silo.cache().statistics()
console.log(statistics.hits, statistics.misses, statistics.evictions, statistics.size)
console.log(statistics.requests(), statistics.hitRate())

// Discard this client's cached responses after changes made by another client.
silo.cache().clear()
```

Omit `cache` or set `{ enabled: false }` to disable caching. When enabled, `ttl`
and `maxSize` must be supplied unless a method's decorator supplies them.
The built-in entry reads use `@Cache()` without overrides, so both settings are
required in the client options. Silo supplies no TTL or capacity defaults.
`ttl` is in milliseconds, measured from insertion; hits do not extend it.
`maxSize` limits responses per resolved policy. Equal TTL and capacity settings
share a cache within that client. Numeric validation belongs to `@isaacs/ttlcache`.
Use a finite positive TTL: upstream TTLCache 2.1.5 cannot safely enforce a finite
capacity with `ttl: Infinity`. `maxSize: Infinity` is supported with a finite TTL.

Only collection entry reads are cached. `get()` and `list()` declare `@Cache()`;
`all()` and `pages()` reuse `list()`. The cache holds decoded JSON and creates
fresh pagination objects with working navigation methods. Health, schemas, other
metadata, searches and writes remain uncached. Successful `null` responses are
cached; errors and `undefined` are not. Stored data and cache hits are cloned so
callers can modify returned entries independently.

Keys combine the HTTP method, the path built by `ApiPath`, and sorted top-level
query parameters encoded by `QueryString`. Different filters, sort orders, page
windows and raw/resolved reads have different keys. Each client owns its cache;
`withKey()` and `withUrl()` create independent caches. Constructor options are
used directly; treat them as immutable for the client's lifetime. A custom
`fetch` must keep its routing and authentication stable for that client.

Successful collection `create()`, `replace()`, `delete()`, `rename()` and
`schema.delete()` invalidate the affected collection's entries and pages. Failed
writes preserve cached data. Other writes, including variable, project and
environment changes, do not trigger automatic invalidation. Use `clear()` after
those changes when a fresh collection read is needed. Clearing and invalidation
do not reset statistics; `evictions` counts expiry and capacity removal only.

Concurrent misses make independent requests. A pending read can refill the cache
after a write or clear, matching the Java client's behavior. Cache hits return
stored data without checking the abort signal. This is an in-memory cache local
to one process, worker or browser tab.

The internal decorator only assigns `method.cachePolicy`. Calls use
`.cache(this.get)` or `.cache(this.list)` on the request builder, which reads that
metadata. This explicit method reference works in both browsers and Node without
caller inspection or an async execution context. Consumers use the built package
and do not need decorator or reflection configuration.

## Entries

Describe your fields and the collection becomes typed.

```ts
interface Movie {
  title: string
  year: number
  status: "draft" | "published"
  genres: string[]
}

const movies = silo.project("moviespace").environment("prod").collection<Movie>("movies")

const created = await movies.create({
  title: "Arrival",
  year: 2016,
  status: "draft",
  genres: ["sci-fi"],
})

await movies.replace(created.id, created.rev, {
  title: "Arrival",
  year: 2016,
  status: "published",
  genres: ["sci-fi", "drama"],
})
```

A row is exactly what the API sent back: your fields and silo's envelope keys
together in one flat object.

```ts
{
  id: "01M24ZX2ZK60T72CNPCM222E3Z",
  rev: 1,
  title: "Arrival",
  year: 2016,
  status: "published",
  genres: ["sci-fi", "drama"],
  created_at: "2026-09-10T06:25:55.699Z",
  updated_at: "2026-09-10T06:25:55.699Z",
}
```


Writes are calls on the collection, and each one takes the revision it expects:

```ts
await movies.create(fields)
await movies.replace(id, rev, fields)
await movies.delete(id, rev)
```

`rev` is the revision the row reported. If it is out of date the call raises
`ConflictError`. A fresh read gives you the current one. `replace` needs
every field, because the route replaces the whole entry.

### Reading an entry you plan to edit

silo substitutes a `{{VARIABLE}}` in your content on the way out. If you write
that value back, you replace the reference somebody typed with whatever it
happened to mean today, and you cannot recover the template from the result. So
read raw before you edit:

```ts
const draft = await movies.get(id, { variables: "raw" })
draft.trailerUrl     // "{{CDN_URL}}/trailers/arrival.mp4", as stored

const { id: _, rev, created_at, updated_at, ...fields } = draft
await movies.replace(draft.id, rev, { ...fields, status: "published" })
```

`{ variables: "raw" }` works on every read: `get`, `list`, `all` and `pages`.
Writes always send raw, so `create` and `replace` answer with what you sent.

Five field names belong to the envelope: `id`, `rev`, `seq`, `created_at` and
`updated_at`. silo refuses a schema that declares one when you create the
collection, and refuses an entry that carries one when you write it. A row can
never collide with its own envelope.

## Queries

You build filters, and a typed collection types them.

```ts
import { Filter, Sort } from "@org-quicko/silo-client"

const page = await movies.list({
  where: movies.filter.field("status").equals("published")
    .and(movies.filter.each("genres").equals("sci-fi")),
  sort: Sort.recentlyUpdated(),
  limit: 20,
})
```

`field` addresses your own fields. `each` addresses every element of an array.
`meta` addresses the envelope.

```ts
movies.filter.field("title").contains("arrival")
movies.filter.each("genres").equals("sci-fi")
Filter.meta("updated_at").greaterThan("2026-01-01T00:00:00Z")
```

A dot reaches inside a nested field, so `field("director.name")` addresses the
`name` of a `director` object.

The operators are `equals`, `notEquals`, `contains`, `greaterThan`, `atLeast`,
`lessThan`, `atMost`, `oneOf` and `exists`. Join them with `and`, `or` and
`not`. `Filter` offers the same calls without types, for a filter you assemble
at runtime, and `Filter.raw(node)` takes the wire format directly.

`each` is a separate call because the two ways of writing a wildcard ask
different questions:

```ts
movies.filter.each("genres").notEquals("horror")          // some genre is not "horror"
Filter.not(movies.filter.each("genres").equals("horror")) // no genre is "horror"
```

## Pagination

```ts
const first = await movies.list({ limit: 25 })
first.total        // 137
first.pageNumber   // 1
first.hasMore      // true

const second = await first.next()
```

A page reports the window silo actually used, which is not always the one you
asked for. silo caps `limit` at 500, and replaces a limit of zero or less with
50. `next()` moves forward by the window silo reported, so an oversized request
still pages correctly instead of stepping over entries.

Every page can be iterated, and two helpers page for you.

```ts
for (const entry of page) { }

for await (const entry of movies.all({ where })) { }
for await (const page of movies.pages({ limit: 100 })) { }
```

Paging by offset over data that is being written is not a snapshot. Sort by
something stable when that matters.

## Media

```ts
import { MediaReference } from "@org-quicko/silo-client"

const poster = await silo.media.upload({
  bytes,
  filename: "arrival.jpg",
  contentType: "image/jpeg",
  folder: "posters",
})

await movies.create({
  title: "Arrival",
  year: 2016,
  status: "draft",
  genres: ["sci-fi"],
  poster: MediaReference.of(poster.id),
})
```

An entry refers to an asset by id, so renaming or moving a file rewrites
nothing. Use `asset.url` for the link you serve, and `asset.reference` for the
value you store. Storing the URL instead is what a later rename breaks.

```ts
await poster.rename("arrival-2016.jpg")
await poster.moveTo("posters/2016")
await poster.setTags(["poster"])        // replaces the whole list
await poster.replace(file)              // new bytes, same id, name and URL
await poster.delete()                   // refused while an entry refers to it
await poster.delete({ force: true })

const usage = await poster.usages()
usage.usages                            // the referring entries this key may read
usage.total                             // the true count
usage.visible                           // how many of them this key may see
```

`replace` swaps the file behind an asset. The id, the reference, the name and
the URL all stay, so every entry that refers to it shows the new file and none
of them is rewritten. The new file must keep the same extension. It needs the
`media:replace` claim, and `entries:update` on each scope that refers to the
asset.

Folders, and a bulk delete that takes up to 100 ids:

```ts
await silo.media.folders.list()
await silo.media.folders.create("posters/2016")
await silo.media.folders.rename("posters", "artwork", { merge: true })
await silo.media.folders.delete("artwork", { recursive: true })

const report = await silo.media.deleteMany(ids, { force: true })
report.deleted
report.failed
```

## Variables

You declare a variable once per project, and give it a value per environment.

```ts
const moviespace = silo.project("moviespace")
await moviespace.variables.declare("CDN_URL", {
  environment: "prod",
  value: "https://cdn.moviespace.com",
})

const environment = moviespace.environment("prod")
await environment.variables.list()
await environment.variables.set("CDN_URL", "https://cdn.moviespace.com")
await environment.variables.unset("CDN_URL")
```

`variable.value` is `null` when this environment has given it no value, which is
not the same as `""`. An empty value substitutes as empty. An unset one leaves
`{{CDN_URL}}` standing in the response.

## Search

The reach is whatever you call it on, so leaving out an argument cannot widen a
search.

```ts
await movies.search({ query: "arrival" })          // one collection
await environment.search({ query: "arrival" })     // one environment
await silo.search({ query: "arrival" })            // everything the key can read
```

A hit says where it was found, and quotes the text that matched.

```ts
const results = await silo.search({ query: "arrival" })
results.hits[0].collection    // "movies"
results.hits[0].snippets      // [{ path, before, match, after }]
results.engine                // "fts5" when the index answered, "scan" when it walked
```

## Errors

There is one class per failure, so you can branch on the type.

```ts
import { ConflictError, ValidationFailedError } from "@org-quicko/silo-client"

try {
  await movies.replace(movie.id, movie.rev, fields)
} catch (error) {
  if (error instanceof ConflictError) {
    // Somebody else wrote first. Read again for the current revision.
    const current = await movies.get(movie.id)
    await movies.replace(current.id, current.rev, fields)
  } else if (error instanceof ValidationFailedError) {
    error.details                // [{ path: "/title", message }]
  }
}
```

`SiloError` is the base class for anything silo refused: `ValidationFailedError`,
`UnauthorizedError`, `ForbiddenError`, `NotFoundError`, `ConflictError`,
`MediaInUseError`, `MediaDeleteStalledError` and `InternalError`.

`NetworkError`, `TimeoutError`, `RequestAbortedError` and `InvalidResponseError`
are not `SiloError`, because silo never answered. A `NetworkError` on a write
does not prove the write failed. Read the entry back before you decide.

## Cancellation

Every call takes the same last argument.

```ts
await movies.list({ limit: 20 }, { signal: controller.signal })
await movies.get(id, { timeoutMilliseconds: 2_000 })
```

`abort()` raises `RequestAbortedError`, and the deadline raises `TimeoutError`.
Nothing is retried for you. A retried `POST` creates a second entry, and only
the caller knows whether a call was safe to repeat.

## Anonymous reads

A key is optional. Without one you reach the collections whose schema does not
set `x-silo-auth`.

```ts
const silo = new Silo({ url: "https://cms.moviespace.com" })
```

## What this client does not reach

Keys, claims, plugins, export and import, settings, audit and observability.
Those are operator surfaces, and the admin UI and the CLI own them. There is no
generic `request()` either. `RouteInventory` lists every route this client
covers and every route it leaves out, and a test holds that list against the
server's own registrations.

## Development

```sh
bun install          # from the repo root
bun test
bun run typecheck
bun run build
bun run test:packaged   # packs the tarball and consumes it from Node, Bun and a browser build
```

The design and the reasoning behind it are in
[docs/design/api-client.md](../../docs/design/api-client.md). The routes are in
[docs/guide/http-api.md](../../docs/guide/http-api.md).

## License

AGPL-3.0-or-later
