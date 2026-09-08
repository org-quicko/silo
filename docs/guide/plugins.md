# Plugins

> How to write, enable, install and inspect a plugin. The design rationale is in [docs/design/plugins.md](../design/plugins.md).

A plugin is a directory under `<data dir>/plugins/` that silo loads because
`silo.toml` names it. `silo add` will put one there and list it for you, but it
is not doing anything you could not: place the directory, list it, it runs.
Plugins live in the data directory rather than beside the binary because a
packaged binary is root-owned and read-only, and because an instance is a
directory you can copy — so an instance travels with its extensions.

A package declares what it **contributes**, and it may contribute more than one
thing:

| Contribution | What it does | Runs |
|--------------|--------------|------|
| `hooks` | Reacts to the entry and collection lifecycle | In a `Worker`, one per plugin |
| `routes` | Serves HTTP under `/api/ext/<name>/` | In the same `Worker` |
| `runtime` | Runs `activate(ctx)` at startup and `deactivate(ctx)` on the way out | In the same `Worker` |
| `ui` | Ships an admin panel, rendered in a sandboxed frame with no origin | In the operator's browser |
| `providers` | Implements the storage or blob-storage port, adding a driver name | In-process, before storage opens |

None of them is exclusive: a storage provider may register the hook that keeps
its own derived data in step, and a plugin that only wants a startup task does
not have to invent a hook to be called. Each provider names its **own entry
module**, because it is imported before storage exists while the rest of the
package runs in a worker afterwards.

The built-in adapters are registered through the same registry, under the
reserved names `sqlite`, `fs` and `s3` that no plugin may take. `[storage]
driver` is a lookup in that registry, so a third-party store is selected exactly
the way a built-in one is.

## Writing one

A plugin needs no build step — silo transpiles TypeScript itself — and **no
dependencies at all**, including on silo.

To start from a working one:

```sh
npm create silo-plugin          # or: bun create silo-plugin
```

[`create-silo-plugin`](../../packages/create-silo-plugin/) asks what the plugin is for and
writes the manifest, a runnable stub per hook you pick, the `silo:api` type
declarations, and the `[[plugins]]` block to paste into `silo.toml`. Everything
below is what it produces, and what to change once you have it.

`<data dir>/plugins/silo-plugin-slug/package.json`

```json
{
  "name": "silo-plugin-slug",
  "type": "module",
  "main": "index.ts",
  "silo": {
    "silo": "^1",
    "contributes": { "hooks": ["entry.beforeValidate"] },
    "permissions": {
      "required": [
        {
          "claim": "collections:*/*/*:entries:read",
          "reason": "To check the slug is not already taken."
        }
      ]
    },
    "config": {
      "type": "object",
      "properties": { "field": { "type": "string" } },
      "required": ["field"],
      "additionalProperties": false
    }
  }
}
```

The `silo` block is the **manifest**, and it is static on purpose: `silo plugin
info` has to show an operator what a package wants *before* any of its code
runs.

| Key | Meaning |
|-----|---------|
| `silo` | The version range of silo this plugin supports, checked at startup. There is no separate plugin API version — a breaking change to a hook payload is a major version of silo. |
| `contributes.hooks` | Which hooks to dispatch. A hook the module exports but does not declare here is never called. |
| `contributes.routes` | The HTTP routes this plugin serves, each `{ "method", "path", "auth", "body" }`. Served under `/api/ext/<name>/`. Declaring any of them asks for the `http:route` claim automatically. `body` is `{ "kind": "text" \| "bytes", "max_bytes" }` and defaults to text at 1 MiB. |
| `contributes.ui` | An admin panel: `{ "entry": "./panel.html", "title" }`, one inlined HTML file. |
| `contributes.runtime` | `true` when the module exports `activate(ctx)` and `deactivate(ctx)`. Declaring it and not exporting them refuses the start. |
| `contributes.providers` | Storage or blob drivers, each `{ "port", "driver", "entry" }`. `entry` is required: a provider is imported before storage exists, so it cannot share the module the worker half runs from. |
| `permissions.required` | What the plugin does not work without. **This is what a default grant approves.** Each entry is `{ "claim", "reason" }`, and the reason is not optional — it is what an operator reads while deciding. |
| `permissions.optional` | Extras. Ungranted is a normal outcome, never an error. |
| `config` | A JSON Schema for `[plugins.config]`, validated at startup. |

A package must contribute *something* — otherwise nothing would ever call it,
and the start refuses saying so. A `hooks:` claim per declared hook, and
`http:route` for declared routes, are added to the request for you; writing them
out again would be two lists to keep in step.

`<data dir>/plugins/silo-plugin-slug/index.ts`

```ts
import { defineSiloPlugin, ValidationError } from "silo:api";

export default defineSiloPlugin({
  "entry.beforeValidate"(event, ctx) {
    if (event.collection !== "posts") return;

    const title = event.data[ctx.config.field];
    if (typeof title !== "string") throw new ValidationError("a post needs a title");

    return { data: { ...event.data, slug: title.toLowerCase().replace(/[^a-z0-9]+/g, "-") } };
  },
});
```

`silo:api` is a **virtual module**. It has no file on disk and is not on npm --
silo injects it into the plugin's import graph before the plugin loads. That is
why a plugin declares no dependencies, and why there is only ever one copy of
`ValidationError` in play instead of one per plugin. For editor support, keep
`apps/server/src/plugins/host/silo-api-types.d.ts` next to your plugin; it is types only
and contributes nothing at runtime. `create-silo-plugin` copies it for you, and
a test in this repo keeps the two byte-identical.

## Enabling one

Two separate decisions, kept apart on purpose.

**Which plugins load, and in what order** is `silo.toml` — the operator's file,
and nothing but a text editor writes it:

```toml
[[plugins]]
name       = "silo-plugin-slug"   # the directory under <data dir>/plugins/
claims     = []                   # a declarative grant; see below
timeout_ms = 5000                 # per dispatch
on_error   = "fail"               # "fail" (default) | "skip"

  [plugins.config]
  field = "title"
```

The array is **ordered, and that order is hook dispatch order** — top to
bottom, with no priority number to compete over and no load-order surprise.

`name` resolves under `<data dir>/plugins/` as either a plain directory or a
`node_modules/<name>` layout. There is deliberately no `SILO_PLUGINS`
environment variable: which code an instance runs is not something the
environment should be able to change.

**What each plugin is allowed to do** is a record in the reserved `_plugins`
collection, changed through `silo plugin grant` or the management API. The split
is the load-bearing part: *if grants lived in config, revoking would need a
restart; if registration lived in the database, whoever could write the database
could execute code.*

A listed plugin that nobody has approved is **`pending`**. It loads, it is
delivered nothing, and every `ctx` call is refused — a state, not a failure, and
the one exception to "a plugin that cannot do its job refuses the start":
approving needs a running server to approve through, so a server that refused to
boot could never be given one. It is loud about it, on every start, in
`silo plugin list`, and in a non-zero exit from `silo plugin doctor`.

```sh
silo plugin grant silo-plugin-slug                  # approve what it says it requires
silo plugin grant silo-plugin-slug --claims a,b     # approve exactly these
silo plugin revoke silo-plugin-slug                 # withdraw the stored grant
```

**The default is `required`, not everything asked for.** A package that declares
nothing optional sees no difference; one that does gets to offer an extra without
having it approved by default, which is the only reading under which "optional"
means anything. `silo plugin info` prints both lists with the author's reason
beside each claim, and the admin UI shows the same thing beside a checkbox. A
grant short of a required claim is a warning rather than a refusal — narrowing on
purpose is a legitimate thing to do — but it is a warning you will see, on the
start and on the change.

Both are offline, against the data directory — the same authority
`silo keys create` already has there — which is what makes them the way out of
that boot deadlock, and the way to provision a plugin in CI.

Effective authority is the **union** of the two paths, each bounded by what the
manifest requested. Two paths because they serve genuinely different
deployments: a container built from a config map cannot use an interactive
grant, and an operator on a box does not want to hand-edit TOML to withdraw one.
`silo plugin revoke` clears only the stored half, and says so when `silo.toml`
still grants something.

Approving mints a real API key for the plugin, with exactly the granted claims
and `owner: {kind: "plugin"}`. Its secret stays host-side and the plugin never
sees it — not because a hostile plugin would gain anything by holding one, but
because the common failure is accidental: a plugin logging its token, or sending
it to a telemetry endpoint. `silo keys revoke` refuses a managed key and names
`silo plugin revoke` instead; a managed key never counts toward bootstrapping,
and is left out of every archive.

## Managing a running instance

Everything under `/api/plugins/` acts on the grant record and the running set,
and **takes effect immediately** — there is no restart in any of these answers:

```sh
curl -X PUT http://localhost:8090/api/plugins/silo-plugin-slug/grant \
  -H "Authorization: Bearer $SILO_KEY" -H 'If-Match: "3"' \
  -H "Content-Type: application/json" \
  -d '{"claims": ["collections:blog/prod/posts:entries:read"]}'
```

| Call | Claim | Does |
|------|-------|------|
| `GET /api/plugins`, `/api/plugins/{name}` | `plugins:read` | what each requested, what it was granted, and what it is doing |
| `PUT`/`DELETE /api/plugins/{name}/grant` | `plugins:grant` | approve or narrow / withdraw. Live on the next hook and the next `ctx` call |
| `POST /api/plugins/{name}/enable`, `/disable` | `plugins:enable` | start or stop the plugin now |
| `PATCH`/`DELETE /api/plugins/{name}/config` | `plugins:configure` | change its config / return it to `silo.toml` |
| `POST /api/plugins/{name}/restart` | `plugins:enable` | bring a worker back after it died |
| `POST /api/plugins/rescan` | `plugins:enable` | re-read `silo.toml` and apply it |

**`If-Match` is required on everything that writes the record**, and on a grant
it is not ceremony: approving means approving *what you read*. Without the
fence, a package whose request changed between the read and the approval would
be approved on the strength of the older one. `restart` and `rescan` write no
record, so neither takes one.

**The API never writes `silo.toml`.** One that could add a `[[plugins]]` block
would be a code-execution primitive wearing a management claim. `rescan` reads
that file — the one the operator already wrote — and applies it: plugins added,
removed, reordered, upgraded in place, or reconfigured. It is also how a grant
made with the offline CLI reaches a server that is already running.

`enabled` is orthogonal to the grant. A disabled plugin keeps its claims and its
key, because pausing something is not the same decision as un-approving it — and
an operator who had to re-approve after every pause would learn to approve
widely to avoid the trouble.

`PATCH .../config` takes an [RFC 7396](https://www.rfc-editor.org/rfc/rfc7396)
merge patch, so one setting changes without restating the block and `null`
removes one. The result **replaces** `silo.toml`'s block for that plugin rather
than merging with it — two config documents have no sane join, and "what config
is this plugin running with" should be something you read, not something you
compute. `DELETE .../config` is the way back, and `config_source` on every view
says which of the two is in force.

Every view carries a `runtime` block — `running`, `stopped` or `failed`, with a
sentence saying why when it is not running. That is a different question from
`enabled` and `state`, which are what an operator *decided*: a granted, enabled
plugin whose worker outlived its dispatch budget is torn down and not respawned,
and `POST .../restart` is the deliberate way back. A restart is never automatic —
a plugin that missed its budget is usually still spinning, so a respawn would
walk into the same wall while hiding that anything happened.

**All of it is in the admin UI** under *Settings → Plugins*, which is the same
API with sentences around it: what a plugin asked for beside what you allow, the
claims narrowed to a project and environment with two selects, a settings form
generated from the plugin's own manifest schema, and the trail below. It leads
with hook delivery and flags a hook that can change or stop a write, because
`entry.beforeValidate` over a collection is a larger authority than
`entries:update` and reads like a smaller one.

**Who changed what** is `GET /api/audit`, behind `audit:read`. It records
authority decisions only — `key.create`, `key.revoke`, `plugin.grant`,
`plugin.revoke`, `plugin.enable`, `plugin.disable`, `plugin.configure` — and
never entry writes, which is what `rev`, `updated_at` and the hook stream
already are. The **services** append rather than the routes, so a change made
with the offline CLI is in it too. Retention is unbounded on purpose: an
authority log grows with decisions, not with traffic.

## Hooks

Six. The five entry hooks each carry `op`, so `create` and `update` share one
function:

| Hook | May | Notes |
|------|-----|-------|
| `entry.beforeValidate` | replace `data`, reject | The only mutating hook |
| `entry.beforeWrite` | reject | The data is already validated |
| `entry.afterWrite` | observe | Best-effort, at-most-once |
| `entry.beforeDelete` | reject | Carries the entry, not just its id |
| `entry.afterDelete` | observe | Best-effort, at-most-once |
| `collection.afterDelete` | observe | One event per collection erased, however many entries went |

`collection.afterDelete` is the only way to hear about a **forced** delete.
`DELETE .../collections/{name}?force=true`, and the environment and project
equivalents, erase every entry underneath without dispatching
`entry.afterDelete` for each of them — one event per row would make a 100k-row
delete a 100k-event fan-out for a fact that is one sentence long. So the event
carries the collection, `erased`, and a `cause` of `collection`, `environment` or
`project`; the last two mean every sibling collection is going too, so the useful
reaction is to drop the scope rather than one table. There is no `before`
counterpart: a veto there would overrule an explicit `force` from a caller who
already had to hold `entries:delete` at that reach.

Mutation happens **before** validation, so the schema judges exactly what gets
stored. After validation a hook may reject but not rewrite — otherwise it would
store a value the schema never saw.

Plugins shape `data`. The envelope — `id`, `rev`, `seq`, timestamps — belongs
to silo, and no hook can set it.

**Hooks are lifecycle events, not HTTP middleware.** They fire for the CRUD API
and for a plugin's own writes. They deliberately do *not* fire for `silo import`
or a scope copy: an import reproduces an archive faithfully, and a hook
rewriting data mid-import would make export then import non-idempotent — which
is the single property [Export, import and copy](transfer.md) rests on.

**Delivery is claim-checked**, before the event crosses into the worker — see
below.

## Serving routes

A plugin can answer HTTP itself. Declare the routes in the manifest, implement
each as a function named the same way, and silo serves them under
`/api/ext/<name>/`:

```json
"silo": {
  "contributes": {
    "routes": [
      { "method": "GET",  "path": "/health", "auth": "public" },
      { "method": "POST", "path": "/reindex/:collection" }
    ]
  },
  "permissions": {
    "required": [
      {
        "claim": "collections:*/*/*:entries:read",
        "reason": "To count what a reindex would queue."
      }
    ]
  }
}
```

Declaring routes asks for `http:route` on the plugin's behalf — there is no need
to list it.

```ts
export default defineSiloPlugin({
  "GET /health"() {
    return { ok: true };
  },

  async "POST /reindex/:collection"(request, ctx) {
    if (!request.caller.claims.includes("*")) {
      throw new ForbiddenError("this one is for admins");
    }
    const page = await ctx.entries.list(
      { project: "blog", env: "prod" },
      request.params.collection,
    );
    return { status: 202, json: { queued: page.total } };
  },
});
```

A handler takes `(request, ctx)` and returns a value, never a status code:
nothing is a `204`, a string is `text/plain`, any other object is a JSON body,
and `{ status, headers, body }` or `{ json }` sets one explicitly. Throwing
`ValidationError` or `ForbiddenError` answers `400` or `403`, exactly as it does
from a hook.

`request` carries the method, the declared `path`, the bound `params`, the
`query`, the `headers`, the `body` as text, and `caller`. **`caller` is who is
calling, never how they proved it** — an id, a label and their claims, with
`Authorization`, `X-Api-Key` and `Cookie` withheld. It is `null` on a `public`
route reached with no credential.

Two things are worth being deliberate about.

**A route runs with the plugin's authority, not the caller's.** That is what a
plugin route is for — a handler bounded by the caller's claims could only do what
the caller could have done directly — but it means **reaching a route is reaching
the plugin's grant**. Serving routes at all therefore costs the `http:route`
claim, which declaring one adds to the request for you, and `auth: "public"` is a separate line on the grant screen, because a
public route publishes whatever the plugin was granted to anyone who can reach
the URL. Check `request.caller.claims` when a route should be narrower than the
plugin is.

**silo matches the routes; a plugin never registers one.** The grammar is literal
segments and `:name` parameters — no wildcards, no regular expressions — and a
path that could reach outside the namespace is refused at startup, naming the
package. The upshot is that a plugin cannot shadow or reorder a built-in route,
and that its routes come and go with `enable`, `disable`, `grant`, `revoke` and
`rescan` without a restart, like its hooks.

`HEAD` reaches a declared `GET`. A handler that misses `timeout_ms` answers `504`
and the plugin is left `failed` until `POST /api/plugins/<name>/restart`.

**A route says what body it takes.** The default is text, capped at 1 MiB. A route
that receives a *file* declares bytes instead, and is handed `request.bytes`
undecoded while `request.body` stays `null`:

```json
{ "method": "POST", "path": "/source", "body": { "kind": "bytes", "max_bytes": 67108864 } }
```

The cap is yours to declare and silo's to bound, at 64 MiB. It is in the manifest
because it is how much the host will allocate for whoever reaches the route — so
an operator reads the number beside the route when they approve `http:route`, and
raising it in a later release asks them again. Past it, a request is **refused**
rather than truncated: a plugin cannot tell a body it was not given from one that
was never sent, so the alternative is a `200` describing work done on the wrong
input.

## Shipping a screen

A plugin can bring its own page in the admin. Declare one inlined HTML file:

```json
"silo": { "contributes": { "ui": { "entry": "./panel.html", "title": "Import from Strapi" } } }
```

It appears under **Settings → Plugins → your plugin**, below the grant, and it
runs in an iframe with `sandbox="allow-scripts"` and **no** `allow-same-origin` —
so it has no origin of its own. `localStorage` throws, `document.cookie` is empty,
and nothing it fetches carries a credential. That is not belt-and-braces: the
admin keeps an API key for every server you have configured, and a panel able to
read them would hold more than any plugin can be granted.

Its one capability is `window.silo`, which the admin injects:

```html
<script>
  const source = await silo.json('/source')          // → /api/ext/<name>/source
  await silo.fetch('/source', { method: 'POST', body: await file.arrayBuffer() })
</script>
```

Those reach **your plugin's routes and nothing else**, with the operator's key
attached by the admin. So a panel spends the operator's authority over your
routes, and your handlers spend the plugin's grant — which is why none of your
routes has to be `public` for a screen to work. The admin's theme arrives as CSS
custom properties, so `var(--text)` and `var(--accent)` follow whatever the
operator has on.

## What a plugin is allowed to do

A plugin never receives the database or the service. It acts through `ctx`, and
a `ctx` call **is a request against silo's own HTTP API** — the same routes, the
same guards, the same answers a key with those claims would get. That is not an
analogy for the claim check; it is the claim check. **A plugin is an API key
with code attached.**

```ts
// The typed client, for what a plugin usually wants:
const page = await ctx.entries.list(event.scope, "posts", { limit: 10 });

// ...and the API underneath it, for everything else. Paths must be under
// /api/; a refusal comes back as a status, not a throw.
const response = await ctx.fetch("/api/media?limit=5");
```

Authority comes from two places and is the **union** of them: the `claims` in
`silo.toml`, and what an operator approved through `PUT
/api/plugins/{name}/grant` or `silo plugin grant`. Neither may exceed what the
manifest requested.

```toml
claims = ["collections:blog/prod/posts:entries:read"]
```

Being *told about* a hook is its own claim, separate from any `entries:*`
permission — being handed a value before it is validated is not reading a
committed one. It is checked **before the event crosses into the worker**,
because a check on the far side would be an audit trail rather than a boundary:

```toml
claims = ["hooks:blog/prod/posts:entry.beforeValidate"]
```

A plugin whose grant delivers a hook it declares in **no** scope at all refuses
the start. A missing API claim is not an error — a plugin may run on less than
it asked for — but a hook that can never fire means the plugin loads, looks
healthy, and never does the thing it was installed for.

A plugin may never be granted `root`, the `plugins:*` claims, or
`keys:create|revoke|import` — it runs code, so any of those would let it widen
its own grant, or make the grant irrelevant. Every other claim uses the grammar
in [Authentication and claims](claims.md).

A plugin that declares `contributes.runtime` gets `activate(ctx)` once it is
live, and `deactivate(ctx)` on the way out. `activate` runs before silo takes its
first request, so setup that must succeed belongs there — a throw refuses the
start, naming the plugin. It costs no claim, because nobody but silo calls it and
its `ctx` is the same claim-checked surface a hook's is; what it adds is work
nothing asked for, not reach. `deactivate` is best-effort: the decision to stop
has been taken by the time it runs.

Withdrawing a grant is **live**: the next hook is not delivered and the next
`ctx` call is refused, with no restart and without the plugin being torn down.
Changing what a key may do has never meant restarting whoever holds it, and a
plugin is an API key with code attached.

Throwing `ValidationError` or `ForbiddenError` from a hook is a **deliberate
rejection** and surfaces as a 400 or 403. Any other throw is a **plugin fault**,
governed by `on_error`: `fail` refuses the write, `skip` logs it and carries on.
Either way it is logged. `afterWrite` and `afterDelete` never fail a request --
the write has already committed, and a 500 there would invite a retry that
writes twice.

## The trust boundary

Extension plugins run in a `Worker`. **That bounds faults, not malice.** A
plugin that crashes, spins forever, or eats memory is timed out, torn down and
reported while the server keeps serving, and it is not restarted into the same
wall on the next write. It does *not* stop plugin code reading the database or
opening a socket: worker code holds full privileges.

The trust boundary is the act of installing, exactly as it is for an npm
package, a VS Code extension, or a Strapi plugin. The claim check expresses
intent and catches mistakes; it is not a sandbox. Read a plugin before you place
its directory.

## Installing

```sh
silo add ./my-plugin                     # a directory you have
silo add ./silo-plugin-slug-1.2.0.tgz    # a package file
silo add silo-plugin-slug@^1             # from npm
silo add https://example.com/p.tgz --integrity sha512-...
silo add https://github.com/acme/silo-plugin-slug --ref v1.2.0
```

`silo add` unpacks the package into `<data dir>/plugins/<name>/` and appends a
`[[plugins]]` block to your `silo.toml`. You can still do both by hand — the
directory it writes is the one you would have placed yourself, and nothing
downstream can tell the difference.

It **runs none of the package's code**, and no lifecycle script, ever. The
manifest is validated, the `silo` range is checked against your binary, and a
provider is refused a reserved driver name — all before anything is imported.
Archives are refused if they contain absolute paths, `..`, symlinks, hard links,
device nodes, or setuid/setgid/sticky mode bits, and are checked in full before a
single file is written, so a bad package leaves nothing behind. An ordinary
executable at `0755` is fine — the mode check is about privilege, not the
executable bit.

What can be verified depends on where it came from, and `add` tells you which
you got:

| Source | Checked against |
|--------|-----------------|
| npm | the registry's own `sha512` digest — and `--integrity` too if you pass one, in which case both must agree |
| https URL | `--integrity` if you pass one — otherwise TLS alone, and it says so |
| local `.tgz` | `--integrity` if you pass one; a digest is computed either way, so the *next* install is checked |
| directory | nothing is transferred, so `--integrity` is refused rather than ignored |
| git | nothing — pinned by resolved commit; `--integrity` is refused |

Passing `--integrity` to npm is worth it when you know the digest independently:
the registry supplies both the tarball and the digest it is checked against, so
pinning is what a compromised registry cannot satisfy.

A plugin's claims are shown before they are granted, and you are asked. That
distinction is the point: a manifest *requests* claims, you *grant* them.

```
--claims a,b     grant these instead of what the manifest requests
-y, --yes        do not ask (a non-interactive shell without this is a no)
--force          replace an already-installed plugin of the same name
--no-register    install the files, print the block, leave silo.toml alone
```

`<data dir>/plugins/silo-plugins.lock.json` records what was installed, where it
came from, and what it was verified as. It is a **record, not a resolver**:
`serve` still loads exactly what `silo.toml` names, and deleting the lockfile
breaks nothing.

silo installs no dependencies. A plugin needs none — that is what `silo:api`
buys — and a package that declares some is installed with a warning rather than
a dependency tree. There is no `remove`: `POST /api/plugins/{name}/disable`
stops one on a running server, deleting the `[[plugins]]` block stops it
loading at all, and deleting the directory is how you are rid of it.

A running server picks up an added plugin on `POST /api/plugins/rescan`, or at
its next start — never on its own. Placing a directory under `plugins/` is not
consent to run it, and neither is listing it: the plugin still arrives
`pending` and is granted separately.

## Inspecting

```
silo plugin list             configured plugins, what they attach to, their state and claims
silo plugin info <name>      one plugin's manifest, requested vs granted claims, config
silo plugin doctor           load everything the way serve would, report failures, exit
```

All three are read-only and need no network. `list` and `info` read the manifest
without executing anything, so they still work on a plugin that would fail to
load, and both show the request beside the grant — `[pending]`, `[granted]`,
`[needs_review]` or `[granted, disabled]`. `doctor` answers "would `serve`
start?" without starting a server, and exits non-zero when the answer is no,
including when a plugin would start and quietly do nothing.

An upgrade never escalates. A package that starts asking for more moves its
record to `needs_review` and **keeps running on the grant it had** — the new
claims are simply not in it — and the digest the record was approved against is
deliberately not advanced while a review is outstanding, or a second start would
settle it silently.

A plugin that fails to load — a missing directory, a version range that
excludes this binary, invalid config, a claim that was not granted, a declared
hook the module does not export — **refuses the start**. It is never skipped
with a warning: an instance that runs, looks healthy, and has quietly stopped
doing what a plugin was installed to do is the worst outcome available.

