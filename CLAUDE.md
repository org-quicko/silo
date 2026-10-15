# silo — instructions for AI assistants

- Read [CONTEXT.md](CONTEXT.md) first — it describes the current state and
  indexes `resources/context/`. [IMPLEMENTATION.md](IMPLEMENTATION.md) is the
  design spec; check its decision index (D1–…) before proposing architectural
  changes, open the full row in
  [resources/design/decisions.md](resources/design/decisions.md), and read the
  relevant `resources/design/` file before changing what it describes.
- `resources/` holds the internal docs (`context/`, `design/`, `guide/`,
  `openapi.json`). `docs/` is the public Mintlify site, a separate thing.
- Keep CONTEXT.md and IMPLEMENTATION.md short: a new decision is one line in
  the index plus a full row in `decisions.md`; history goes in the changelog,
  not in CONTEXT.md.
- Follow [resources/context/code-design.md](resources/context/code-design.md):
  one artifact per file, short files, full names, concise doc comments with
  the rationale in `resources/`.
- Any change to code, architecture, or repo layout MUST update CONTEXT.md and
  the affected `resources/context/` file in the same change set. A change worth
  remembering also gets an entry at the top of
  [resources/context/changelog.md](resources/context/changelog.md).
- [resources/openapi.json](resources/openapi.json) describes every HTTP route
  the server serves. It is written by hand — Hono registers routes as code, so
  nothing generates it — which makes it a promise rather than a derivation.
  **Adding, removing or changing a route, a query parameter, a request body, a
  response shape or the claim a route asks for MUST update it in the same
  change set**, beside `resources/guide/http-api.md` and
  `resources/design/http-api.md`. Its `x-maintenance` field says the same thing
  to anyone who arrives at the file first.
- NEVER run `git add`, `git commit`, or `git push` in this repo. The user
  stages and commits everything themselves. Leave the working tree dirty.
