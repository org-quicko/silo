# Code design rules

> How code in this repo is expected to be shaped. Where things go is
> [repo-map.md](repo-map.md).

## Shape

- **Object-oriented.** No loose top-level functions. Utilities, helpers and
  logic live on classes — usually as static methods on a named class rather
  than a bag of exports.

  The one exception is the admin UI, where React components and hooks are
  functions because that is React's contract. Everything in the UI that is
  *not* a component or a hook is still a class: `SchemaDraft`, `FilterModel`,
  `ByteSize`, `ThemeManager`, `Store`, `StoreKeys`.

- **One artifact per file.** Every exported class, interface, standalone
  function and React component gets its own file. The exception is a type that
  exists only as that artifact's options or props shape — `SiloServiceOptions`
  stays with `SiloService`.

- **Files stay short.** Target 100–150 lines; treat anything past ~200 as a
  signal to look for the seam. Cohesion wins over the number: a facade of
  one-line delegations is fine at 200 lines, and a class doing three jobs is
  not fine at 120.

- **Full names.** `service`, not `svc`. `config`, not `cfg`. `options`, not
  `opts`. `caught`, not `e`. A loop or lambda binding is named for what it
  holds — `entry`, `collection`, `claim` — not for its type's first letter.

- **Modular by subject.** A large subsystem is a directory whose files each
  own one concern, with an `index.ts` when there is a public surface worth
  naming. `plugins/` is the model: five submodules, a one-way dependency
  direction, and callers importing the directory rather than a file inside it.

## Comments

- **Doc comments say what a reader needs at the call site**, in one to three
  lines. A longer note earns its place only where behaviour is genuinely
  surprising, and then it says what is surprising and why.

- **Rationale lives in `docs/`, not in the source.** Why an interface has the
  shape it has, why an approach was rejected, what a decision cost — that is
  what `docs/design/` is for, and a comment should link to it rather than
  restate it.

- **Inline comments explain the non-obvious line**, not the obvious one. If the
  code needs a paragraph to be legible, the code is what to change.

## Tests

- `apps/server/test/` mirrors `apps/server/src/`, one directory per subject.
- `apps/server/test/conformance/` is the `Storage` port's contract: every
  adapter runs the same suites, because a port with several implementations is
  only a port if they all answer the same questions the same way.
- **The Postgres tests need `SILO_TEST_PG_URL`** (a `postgres://` URL to a
  database the role may create schemas in). Unset, `postgres.test.ts` is
  skipped and says so. Each test opens a store on a `silo_test_<ulid>` schema
  and drops it, so a run leaves the database as it found it; a killed run can
  leave some behind, safe to drop by that prefix. A pooled store keeps the
  process alive until it is closed, so a test must close every store it opens —
  the conformance context closes its last one in an `afterAll`.
- **Take a Postgres rejection with `try`/`catch`, not `expect(...).rejects`.**
  Under Bun 1.4.2 on Windows, `.rejects` awaiting a refused `PgStore.open` after
  the conformance run crashed the runner — a segfault, or a spin at full CPU
  with every connection closed — while the same code in a plain script, looped
  forty times, did not. `refusal()` in `postgres.test.ts` is the pattern. The
  conformance suites' own `.rejects` calls are unaffected so far; the trigger
  was a rejection that had rolled back a transaction and closed its pool.
- UI tests sit beside the source they cover, as `*.test.ts`.
- White-box tests that reach into a private do so deliberately and say so.
- `Response.json()` answers `unknown`. A test that reads fields off a body
  names the shape it expects — the source's own interface where there is one,
  or a local one carrying just the fields the cases read — rather than casting
  to `any`. `variables-api.test.ts` and `search-api.test.ts` are the pattern.
- **The storage read thread is off under `bun test`, and a test that turns it
  on settles a worker-backed promise before `expect(...).rejects` or
  `.resolves`.** Since D81 every entry list and search on SQLite can run on
  `SqliteReadThread`, and so can anything built on one: `keys.authenticate`,
  `plugins.grant`, the media folder guards. Under `bun test` 1.3.14, once a
  `Worker` has answered two earlier round trips, a promise handed to
  `.rejects`/`.resolves` while a third reply is outstanding never settles —
  the reply is not delivered while that wait runs. Measured with a plain echo
  worker too, so it is the runner's wait, not silo; the server is unaffected,
  `Bun.serve` delivers the replies. Because the process shares one thread,
  every test after the first would trip it, so `SqliteStore.readThreadDefault`
  answers `false` when `NODE_ENV` is `test` (which the runner sets) and the
  suite runs the same SQL on the main connection. `sqlite-read-worker.test.ts`
  passes `{ readThread: true }` and is where the thread is exercised; a test
  that does the same must await its reads plainly, or settle first:
  `const attempt = call(); await attempt.catch(() => {}); await expect(attempt).rejects.toThrow(...)`.

## UI styling

- Component- or feature-specific rules go in a `.module.css` beside the owning
  `.tsx`. Reach for a shared primitive before adding a cross-feature selector.
- Globals stay in `apps/admin/src/styles/`: `tokens.css`, `global.css`,
  `forms.css`, `layout.css`, `feedback.css`, `utilities.css`. A new global
  selector should be a deliberately shared primitive, not a shortcut for one
  screen.
- Static presentation belongs in CSS. Inline `style` is for values computed at
  runtime — a data table's schema-derived columns, an animation delay.
- Run `bun run lint` after styling changes.
