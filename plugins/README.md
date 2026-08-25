# plugins

First-party silo plugins. Each subdirectory is a workspace package and follows
the same contract as any third-party plugin (D31, `IMPLEMENTATION.md` §13):

- `package.json` carries the static manifest under a `silo` key — the version
  range it supports, what it `contributes`, the `permissions` it asks for with a
  reason for each, and a JSON Schema for its config.
- The module's default export is a descriptor of functions. Importing it has no
  side effects and nothing self-registers.
- The host is reached through the `silo:api` virtual module, so a plugin
  declares no dependency on silo itself.

Scaffold one with `bun run --cwd packages/create-silo-plugin dev`, or from an
npm install of `create-silo-plugin`.

Nothing here is loaded automatically. A plugin runs when it is placed under
`<data dir>/plugins/` and named in the ordered `[[plugins]]` array in
`silo.toml`.
