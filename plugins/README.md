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

Scaffold one with `bun run packages/create-silo-plugin/src/main.ts`, or from an
npm install of `create-silo-plugin`.

Nothing here is loaded automatically. A plugin runs when it is placed under
`<data dir>/plugins/` and named in the ordered `[[plugins]]` array in
`silo.toml`.

## What is here

| | |
|---|---|
| [`silo-plugin-strapi-import`](silo-plugin-strapi-import) | Imports a Strapi 5 SQLite export into silo collections — entries, and the uploads they reference — driven from a panel in the admin. |
| [`silo-plugin-observability`](silo-plugin-observability) | Shows normalized API traffic, errors and latency alongside process memory and bounded local-storage measurements. |

## Why a first-party plugin is worth the space

Not as a bundled feature — nothing here ships enabled, and none of it is in the
binary. It is the D7 test applied to the plugin contract: **a mechanism should
carry its most demanding consumer before a stranger sees it.**

Writing the first one found that two of its three requirements were *impossible*
rather than awkward. A plugin route decoded every body as UTF-8 and capped every
route at one global mebibyte, so a plugin whose job is ingesting a file could not
be handed one; and there was no way to give a plugin a screen that did not
involve publishing it at an unauthenticated URL. Both are fixed in D41/§13.20,
along with a hole it exposed in D33's promise that a plugin never hears about a
write it caused.

Its media half then found something a second time, and in the same direction: a
media field imported as a copy of Strapi's own media object validated, read back
correctly, and was **inert**, because everything silo does with media keys off the
`x-silo-type: "media"` keyword. A faithful translation with no behaviour behind it
is the failure this repo keeps catching late, and it was caught here by asking what
silo would *do* with the value rather than whether the value was right.

That is the standard for adding another: a plugin belongs here when building it
would shake out the contract, not when the feature happens to be useful.
