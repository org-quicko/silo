# silo-client

The typed client for [silo](https://github.com/org-quicko/silo). It follows
silo's own shape: an instance holds projects, a project holds environments, an
environment holds collections, and a collection holds entries.

```sh
npm install silo-client
```

Runs on Node 18+, Bun, Deno, browsers and workers. No dependencies.

## Start

```ts
import { Silo } from "silo-client"

const silo = new Silo({ url: "http://localhost:8090", key: process.env.SILO_KEY })

const posts = silo.project("acme").environment("prod").collection("posts")

const page = await posts.list({ limit: 10 })
for (const post of page.entries) {
  console.log(post.fields.title)
}
```

Handles are cheap. `silo.project("acme").environment("prod")` makes no request,
so nothing above needs an `await` until the read.

Both scope names are always explicit. There is no default project or
environment, because a client that guesses reads the wrong environment quietly.
`silo.scope("acme", "prod")` is the same chain in one call.

## Entries

Name your fields and the collection is typed.

```ts
interface Post {
  title: string
  status: "draft" | "published"
  tags: string[]
}

const posts = silo.project("acme").environment("prod").collection<Post>("posts")

const created = await posts.create({ title: "Hello", status: "draft", tags: [] })

const draft = await posts.edit(created.id)
draft.fields.status = "published"
await draft.save()
```

An entry keeps its own revision, so you never hold one. `save()` sends the
revision it read, adopts the one it gets back, and raises `ConflictError` if
somebody wrote first.

`get` and `edit` answer different things, and the difference matters.

| Call | Answers | Variables | `save()` |
|------|---------|-----------|----------|
| `posts.get(id)` | `ResolvedEntry<Post>` | substituted | not available |
| `posts.edit(id)` | `Entry<Post>` | left as written | available |

A `{{VARIABLE}}` in your content is substituted on the way out. Saving an entry
you read that way would write the substituted value over the reference, so a
read that substitutes has no `save()` at all, and `edit` is how you read an
entry you mean to write back.

`posts.editable` is the whole read surface with the same rule, for a tool that
edits more than one entry at a time.

```ts
await posts.editable.get(id)
await posts.editable.list({ limit: 50 })
for await (const post of posts.editable.all()) { }
```

`replace(id, rev, fields)` and `delete(id, rev)` are there for when you hold an
id and a revision from somewhere else. Both `replace` and `save` send every
field, because the route is a full replace.

Five field names never survive a round trip, because silo strips them before it
answers: `id`, `rev`, `seq`, `created_at` and `updated_at`. `ReservedFieldNames`
holds the list, and creating a collection warns if its schema declares one.

## Queries

Filters are built, and a typed collection types them.

```ts
import { Filter, Sort } from "silo-client"

const page = await posts.list({
  where: posts.filter.field("status").equals("published")
    .and(posts.filter.each("tags").equals("release")),
  sort: Sort.recentlyUpdated(),
  limit: 20,
})
```

`field` addresses your own fields, `each` addresses every element of an array,
and `meta` addresses the envelope.

```ts
posts.filter.field("author.name").contains("ada")
posts.filter.each("tags").equals("release")
Filter.meta("updated_at").greaterThan("2026-01-01T00:00:00Z")
```

The operators are `equals`, `notEquals`, `contains`, `greaterThan`, `atLeast`,
`lessThan`, `atMost`, `oneOf` and `exists`, joined with `and`, `or` and `not`.
`Filter` has the same surface untyped, for a filter you assemble at runtime,
and `Filter.raw(node)` takes the wire AST.

Two spellings of a wildcard mean two different things, which is why `each` is
its own call:

```ts
posts.filter.each("tags").notEquals("draft")          // some tag is not "draft"
Filter.not(posts.filter.each("tags").equals("draft")) // no tag is "draft"
```

## Pagination

```ts
const first = await posts.list({ limit: 25 })
first.total        // 137
first.pageNumber   // 1
first.hasMore      // true

const second = await first.next()
```

A page reports the window silo actually used, which is not always the one you
asked for: silo caps `limit` at 500 and replaces a nonpositive one with 50.
`next()` advances by the answered window, so an oversized request pages
correctly instead of stepping over entries.

Every page is iterable, and two iterators page for you.

```ts
for (const entry of page) { }

for await (const entry of posts.all({ where })) { }
for await (const page of posts.pages({ limit: 100 })) { }
```

Offset paging over data being written is not a snapshot. Sort by something
stable when that matters.

## Media

```ts
import { MediaReference } from "silo-client"

const asset = await silo.media.upload({
  bytes,
  filename: "hero.png",
  contentType: "image/png",
  folder: "heroes",
})

await posts.create({
  title: "Hello",
  status: "draft",
  tags: [],
  cover: MediaReference.of(asset.id),
})
```

Entries reference an asset by id, so renaming or moving a file rewrites
nothing. `asset.url` is the link to serve; `asset.reference` is the value to
store. Storing the URL is the mistake a later rename breaks.

```ts
await asset.rename("hero-2.png")
await asset.moveTo("heroes/2026")
await asset.setTags(["banner"])        // replaces the list
await asset.delete()                   // refused while an entry references it
await asset.delete({ force: true })

const usage = await asset.usages()
usage.usages                           // the referrers this key may read
usage.total                            // the true count
usage.visible                          // what this key may see of it
```

Folders, and a bulk delete capped at 100 ids:

```ts
await silo.media.folders.list()
await silo.media.folders.create("heroes/2026")
await silo.media.folders.rename("heroes", "banners", { merge: true })
await silo.media.folders.delete("banners", { recursive: true })

const report = await silo.media.deleteMany(ids, { force: true })
report.deleted
report.failed
```

## Variables

A variable is declared once per project and valued per environment.

```ts
const acme = silo.project("acme")
await acme.variables.declare("API_URL", { environment: "prod", value: "https://api.acme.com" })

const environment = acme.environment("prod")
await environment.variables.list()
await environment.variables.set("API_URL", "https://api.acme.com")
await environment.variables.unset("API_URL")
```

`variable.value` is `null` when this environment has given it nothing, which is
not `""`. An empty value substitutes as empty; an unset one leaves `{{API_URL}}`
standing in the response.

## Search

The reach is whatever you call it on, so a missing argument cannot widen a
search.

```ts
await posts.search({ query: "pricing" })          // one collection
await environment.search({ query: "pricing" })    // one environment
await silo.search({ query: "pricing" })           // everything the key can read
```

A hit says where it was found and quotes why it matched.

```ts
const results = await silo.search({ query: "pricing" })
results.hits[0].collection    // "posts"
results.hits[0].snippets      // [{ path, before, match, after }]
results.engine                // "fts5" when the index answered, "scan" when it walked
```

## Errors

One class per failure, so you branch on the type.

```ts
import { ConflictError, ValidationFailedError, NetworkError } from "silo-client"

try {
  await draft.save()
} catch (error) {
  if (error instanceof ConflictError) {
    await draft.refresh()        // somebody else wrote first
  } else if (error instanceof ValidationFailedError) {
    error.details                // [{ path: "/title", message }]
  }
}
```

`SiloError` is the base for anything silo refused: `ValidationFailedError`,
`UnauthorizedError`, `ForbiddenError`, `NotFoundError`, `ConflictError`,
`MediaInUseError`, `MediaDeleteStalledError` and `InternalError`.

`NetworkError`, `TimeoutError`, `RequestAbortedError` and `InvalidResponseError`
are not `SiloError`, because nothing answered. A `NetworkError` on a write does
not prove the write failed. Read the entry back before deciding.

## Cancellation

Every call takes the same last argument.

```ts
await posts.list({ limit: 20 }, { signal: controller.signal })
await posts.get(id, { timeoutMilliseconds: 2_000 })
```

`abort()` raises `RequestAbortedError` and the deadline raises `TimeoutError`.
Nothing is retried for you: a retried `POST` is a duplicate entry, and only the
caller knows whether a call was safe to repeat.

## Anonymous reads

A key is optional. Without one you reach the collections whose schema does not
set `x-silo-auth`.

```ts
const silo = new Silo({ url: "https://cms.example.com" })
```

## What this client does not reach

Keys, claims, plugins, export and import, settings, audit and observability.
Those are operator surfaces, and the admin UI and the CLI own them. There is no
generic `request()` either: `RouteInventory` lists every route this client
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
