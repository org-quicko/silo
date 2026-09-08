# Authentication and claims

> The claim catalog and the rules that govern it. The design rationale is in [docs/design/core-concepts.md](../design/core-concepts.md).

silo has no users and no browser sessions. A presented key authenticates the
request, and its claims authorize each individual operation. Claims are deny by
default: an operation whose claim is missing is refused.

Keys are `silo_` followed by 32 random bytes, base64url encoded. Only the
SHA-256 hash is stored, so the plaintext secret exists exactly once, in the
response that created it. Revoking a key deletes its record.

```text
*
collections:<project>/<env>/<name>:create
collections:<project>/<env>/<name>:delete
collections:<project>/<env>/<name>:schema:read
collections:<project>/<env>/<name>:schema:update
collections:<project>/<env>/<name>:access:update
collections:<project>/<env>/<name>:entries:create
collections:<project>/<env>/<name>:entries:read
collections:<project>/<env>/<name>:entries:update
collections:<project>/<env>/<name>:entries:delete
hooks:<project>/<env>/<name>:<hook>
media:read        media:create      media:delete      media:configure
keys:read         keys:create       keys:revoke
keys:export       keys:import
plugins:read      plugins:grant     plugins:enable     plugins:configure
audit:read        http:route        settings:configure  observability:read
transfer:export   transfer:import   transfer:copy
```

`*` is the root claim and grants everything.

`hooks:...` is **delivery**, and it is deliberately not implied by any
`collections:...:entries:*` permission: being handed an entry before it is
validated, with the chance to rewrite it, is a different authority from reading
a committed one. It exists for plugins — see [Plugins](plugins.md) — and the
`<hook>` segment is one of the five hook names, with no wildcard.

`media:configure` is not a fourth per-asset permission: it reads and changes how
the library is **set up** — where it keeps its bytes, credentials included,
where its URLs point, and what file types it accepts — and it writes `silo.toml`
to do it. No preset but `root` carries it, no plugin may be granted it, and a
key holding `media:read|create|delete` all day cannot repoint the library. It is
one claim rather than a read/write pair because the read is not the harmless
half: it names the bucket, the endpoint and the access key id.

`settings:configure` covers the rest of `silo.toml` — logging, search, schema
validation, and the auth switch — through **Settings → Configuration** or
`/api/settings`. Root-only and forbidden to plugins, for the same reasons:
`[schema] allow_remote_refs` alone turns every schema validation into an
outbound fetch of the holder's choosing. Two settings there are deliberately not
freely writable. `[storage]` is reported and never written, because changing the
driver or data directory names a *different* instance rather than configuring
this one. `[auth] disabled` can be set to `false` and never to `true`: an API
that could switch off the authentication protecting it is not one.

Not everything on that page applies without a restart, and the page says which
per field. `[log] level`, `format` and `requests` take effect on the next line
written; a log file, the rotation settings, the search tokenizer and the rest are
adopted at the next start, and a saved value waiting for one is reported as
waiting rather than as in force.

`plugins:*` and `audit:read` guard the management API and the authority trail.
There is no `audit:write`: nothing updates or deletes an event, so a claim
guarding that would imply a capability that does not exist.

`observability:read` exposes bounded operating aggregates: registered API route
patterns, status classes, latency histograms, process memory and CPU totals, and
cached local-storage sizes. It never records route parameters, query strings,
caller identities, request bodies, credentials, content, or filesystem paths.
`manage` and `root` carry it; plugins may be granted it. There is no write
counterpart, and remote-provider capacity is reported unavailable rather than
estimated.

`http:route` is the other plugin-shaped claim, beside `hooks:...`: it lets a
plugin **be reached** at the routes its manifest declares, and grants no reach of
its own, so a key holding it gains nothing. One claim covers every route a
manifest lists, because they are all mounted under the plugin's own name and it
cannot escape that prefix — what an operator weighs is the route list itself. See
[Serving routes](plugins.md#serving-routes).

**Wildcards.** Each of `project`, `env`, and `name` independently accepts `*`.
`collections:acme/*/*:entries:read` covers every environment of one project,
`collections:*/prod/*:entries:read` covers production everywhere, and
`collections:*/*/posts:entries:read` covers one collection wherever it lives.
Action wildcards such as `entries:*` are not valid.

**Delegation does not escalate.** A key holding `keys:create` can mint only keys
whose claims its own already cover. A wildcard segment can delegate matching
named segments; a named segment can never widen into a wildcard.

**Public reads.** Collection schema and entry reads are public by default within
their scope. Set `"x-silo-auth": true` in a schema to require a key for both.
Once a key is presented it becomes the visibility boundary, so a scoped key sees
only its own projects, environments, and collections, even public ones.

**Variables add no claim of their own.** Each check is an existing claim at the
reach the operation actually has. Reading needs `entries:read` on any collection
in the environment, because a value is substituted into every entry that
references it, so anyone who can read one entry can already see it. Setting a
value needs `entries:update` across the whole environment
(`collections:{project}/{env}/*:entries:update`), because one value rewrites what
every entry in that environment answers. Declaring and undeclaring reach every
environment in the project, so they ask for `create` and `delete` at
`{project}/*/*`.

**Transfer claims need instance-wide authority.** An archive spans every project
and environment at once, so a `transfer:*` claim is necessary but not
sufficient. Export additionally requires `collections:*/*/*:schema:read` and
`collections:*/*/*:entries:read`; import and copy additionally require
`collections:*/*/*:entries:create`, `:entries:update`, and `:entries:delete`.
Without that rule, `transfer:export` would let a key confined to one project
read every other one.

Copying between two environments of one instance is the exception, and needs no
`transfer:*` claim at all — it reaches nothing the ordinary collection and entry
routes do not, so it asks for those permissions at the two scopes involved
instead. See [Copying between environments](transfer.md#copying-between-environments).

Presets (`root`, `write`, `read`) are conveniences over the same claim set, in
the CLI through `--preset` and in the admin UI's key form. Stored keys must
carry a `claims` array; legacy role or collection-allowlist records are rejected
rather than translated.

