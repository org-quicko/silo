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
  `ByteSize`, `ThemeManager`.

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
- `apps/server/test/conformance/` is the `Storage` port's contract: both
  adapters run the same suites, because a port with two implementations is only
  a port if both answer the same questions the same way.
- UI tests sit beside the source they cover, as `*.test.ts`.
- White-box tests that reach into a private do so deliberately and say so.

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
