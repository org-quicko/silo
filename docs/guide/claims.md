# Authentication and claims

> The claim catalog and the rules that govern it. The design rationale is in [docs/design/core-concepts.md](../design/core-concepts.md).

silo has no users and no browser sessions. A presented key authenticates the
request, and the claims on that key authorize each individual operation. Claims
are deny by default: if the claim for an operation is missing, the operation is
refused.

A key is `silo_` followed by 32 random bytes, base64url encoded. silo stores
only the SHA-256 hash, so the plaintext secret exists exactly once, in the
response that created it. Revoking a key deletes its record.

You can change a key's label and its claims after you create it. Use
`PATCH /api/keys/{id}`, `silo keys update`, or **Edit** in the admin UI key
list. The secret does not change, so the new claims apply immediately to the key
that is already in use. Its holder gets no notice of the change. You need
`keys:create` to do this, and your own claims must cover both what the key holds
now and what you are giving it. silo writes both lists to the audit trail.

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
media:create      media:delete      media:replace      media:purge
media:configure
keys:read         keys:create       keys:revoke
keys:export       keys:import
plugins:read      plugins:grant     plugins:enable     plugins:configure
audit:read        http:route        settings:configure  observability:read
trash:purge
transfer:export   transfer:import   transfer:copy
```

`*` is the root claim, and it grants everything.

## The claims that need a word of explanation

**`hooks:...` is delivery.** No `collections:...:entries:*` permission implies
it, on purpose. Being handed an entry before it is validated, with the chance to
rewrite it, is a different authority from reading a committed one. The claim
exists for plugins, see [Plugins](plugins.md), and the `<hook>` segment is one
of the six hook names, with no wildcard.

**`media:configure` is not a fourth per-asset permission.** It reads and changes
how the library is **set up**: where it keeps its bytes, credentials included,
where its URLs point, and which file types it accepts. It writes `silo.toml` to
do that. Only the `root` preset carries it, no plugin may be granted it, and a
key holding `media:create` and `media:delete` still cannot repoint
the library. It is one claim rather than a read and write pair, because the read
half is not the harmless half: it names the bucket, the endpoint and the access
key id.

**`media:purge` is not part of `media:delete`.** `media:delete` removes files,
one or a hundred at a time, and the **Read & write** and **Manage** roles both
carry it. `media:purge` is the one request that ends every asset in the
library, which is a different job from managing the files you uploaded. Only
the `root` preset carries it, and the route asks for both claims together, so a
key holding `media:purge` alone still purges nothing. The admin hides **Purge
library** from a key that does not hold both.

**`trash:purge` is the only claim the trash adds.** A delete moves its subject
to the trash, and that delete asks for exactly what it always asked for, so no
key changed meaning when the trash arrived. Reading the trash asks for nothing
either: the server shows you an item only if you can read the content it came
from, so a key with `entries:read` on one collection sees deletions from that
collection and no others. Restoring asks for the **write** claims where the
content lands, because putting an entry back into `prod` is writing to `prod`.

What does need a claim is destroying something for good. `trash:purge` covers
deleting one item from the trash, emptying the trash, and `?permanent=true` on
any delete route. Only the `root` preset carries it. The reason is the one
behind `media:purge`: whoever deleted the content already used their delete
claim, and ending it forever is a second decision, usually by someone else and
later. The admin hides **Delete permanently** and **Empty trash** from a key
that does not hold it.

**`media:replace` is not part of `media:create`.** `media:create` uploads a
new file. `media:replace` changes the file behind an asset that is already in
the library, and keeps its id, its name and its URL. Every entry that refers
to that asset then shows the new file. This is a different job from managing
the files you uploaded, so the **Read & write** role does not carry it. The
**Manage** role does, because it is usual content work.

The route also asks for `entries:update` on each project, environment and
collection that refers to the asset. This is the same rule a forced delete
obeys. A replace changes what those entries show, so the key must have
permission to change them. An asset that no entry refers to needs only
`media:replace`.

The new file must keep the same file type. To change a `.png` into a `.webp`,
upload a new asset.

**`settings:configure` covers the rest of `silo.toml`:** logging, search, schema
validation, and the auth switch. It works through **Settings > Configuration**
or `/api/settings`. It is root-only and forbidden to plugins, for the same
reason. `[schema] allow_remote_refs` alone turns every schema validation into an
outbound fetch of the holder's choosing.

Two settings there are deliberately not freely writable. `[storage]` is reported
and never written, because changing the driver or the data directory names a
*different* instance rather than configuring this one. `[auth] disabled` can be
set to `false` and never to `true`: an API that could switch off the
authentication protecting it is not one.

Not everything on that page applies without a restart, and the page says which
per field. `[log] level`, `format` and `requests` take effect on the next line
written. A log file, the rotation settings, the search tokenizer and the rest are
adopted at the next start, and a saved value waiting for one is reported as
waiting rather than as in force.

**`plugins:*` and `audit:read`** guard the management API and the authority
trail. There is no `audit:write`. Nothing updates or deletes an event, so a
claim guarding that would imply a capability silo does not have.

**`observability:read`** exposes bounded operating aggregates: registered API
route patterns, status classes, latency histograms, process memory and CPU
totals, and cached local-storage sizes. It records no route parameter, query
string, caller identity, request body, credential, content, or filesystem path.
The `manage` and `root` presets carry it, and a plugin may be granted it. There
is no write counterpart. Capacity at a remote provider is reported as
unavailable rather than estimated.

**`http:route`** is the other plugin-shaped claim, beside `hooks:...`. It lets a
plugin **be reached** at the routes its manifest declares. It grants no reach of
its own, so a key holding it gains nothing. One claim covers every route a
manifest lists, because they all mount under the plugin's own name and it cannot
escape that prefix. What an operator weighs is the route list itself. See
[Serving routes](plugins.md#serving-routes).

## The rules

**Wildcards.** Each of `project`, `env` and `name` independently accepts `*`.
`collections:acme/*/*:entries:read` covers every environment of one project.
`collections:*/prod/*:entries:read` covers production everywhere.
`collections:*/*/posts:entries:read` covers one collection wherever it lives.
Action wildcards such as `entries:*` are not valid.

**Name patterns.** A segment can also end with `*` to match a name prefix.
`collections:acme*/prod/*:entries:read` covers the production environment of
every project whose name starts with `acme`. Use a pattern to give a team its
own namespace. Without one, the only claim that covers a project that does not
exist yet is `*`, which covers the whole instance.

A pattern needs three or more characters before the `*`. A shorter prefix looks
narrow and grants almost everything. Only a trailing `*` is a pattern:
`ac*me` and `*cme` are not valid. The `*` character is not permitted in the
action part of a claim.

A pattern matches names that do not exist yet. This is the reason to use one and
also the risk. `collections:acme*/prod/*:create` lets the holder create a
project named `acme-anything` and then own it. Read the pattern as a rule, not
as the list of things you can see today.

Write a pattern in the **Custom** tab of the admin UI key form. The Presets and
Advanced tabs show only the projects and environments that exist, so they cannot
show a pattern honestly.

**Delegation does not escalate.** A key holding `keys:create` can mint only keys
whose claims its own claims already cover. A wildcard segment can delegate a
matching named segment. A named segment can never widen into a wildcard.

A pattern follows the same rule. `acme*` can delegate `acme-web` and
`acme-web*`, because each of those matches fewer names. It cannot delegate
`ac*`, because `ac*` also matches `axe`. It cannot delegate `*`.

**A rename does not rewrite a pattern.** When you rename a project, an
environment or a collection, silo rewrites the claims that name it directly. A
pattern is a rule about names and not a reference to one thing, so silo leaves
it as it is. If the rename moves an entity in or out of a pattern, silo records
that in the audit trail as a pattern-affected claim. Read the trail after a
rename to see which keys changed reach.

**Public reads.** Collection schema and entry reads are public by default within
their scope. Set `"x-silo-auth": true` in a schema to require a key for both.
Once a key is presented it becomes the visibility boundary, so a scoped key sees
only its own projects, environments and collections, public ones included.

**Reading the media library needs no claim.** Listing it, reading one asset's
record, its folders and its referrers are all open, the way `/media/<id>` has
always served the bytes themselves. Uploading, renaming, moving and deleting
still need `media:create` or `media:delete`. There used to be a `media:read`,
and it was a lock on the index of a shelf anyone could already reach: a key held
back from it learned nothing it could not learn by fetching a file. It is
retired, so no new key can carry it, and a key that already does is not broken
by it. If you need the library closed, put silo behind something that closes it.

**Variables add no claim of their own.** Each check is an existing claim at the
reach the operation actually has. Reading needs `entries:read` on any collection
in the environment, because a value is substituted into every entry that
references it, so anyone who can read one entry can already see it. Setting a
value needs `entries:update` across the whole environment, as
`collections:{project}/{env}/*:entries:update`, because one value rewrites what
every entry in that environment answers. Declaring and undeclaring reach every
environment in the project, so they ask for `create` and `delete` at
`{project}/*/*`.

**Transfer claims need instance-wide authority.** An archive spans every project
and environment at once, so a `transfer:*` claim is necessary but not
sufficient. Export also requires `collections:*/*/*:schema:read` and
`collections:*/*/*:entries:read`. Import and copy also require
`collections:*/*/*:entries:create`, `:entries:update` and `:entries:delete`.
Without that rule, `transfer:export` would let a key confined to one project
read every other one.

Copying between two environments of one instance is the exception, and it needs
no `transfer:*` claim at all. It reaches nothing the ordinary collection and
entry routes reach, so it asks for those permissions at the two scopes involved
instead. See
[Copying between environments](transfer.md#copying-between-environments).

**Presets** are conveniences over the same claim set. There are four, widest
first: `root`, `manage`, `write` and `read`. The CLI takes one through
`--preset`, defaulting to `read`, and the admin UI's key form offers the same
four. `manage` exists because the collection lifecycle, creating a collection
and editing its schema, is a real job that is not root. `plugins:grant` and
`plugins:enable` are in no preset but `root`, so empowering a plugin is always a
deliberate grant.

A stored key must carry a `claims` array. silo rejects a record that carries a
role or a collection allowlist instead, rather than translating it.
