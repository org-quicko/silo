# silo — instructions for AI assistants

- Read [CONTEXT.md](CONTEXT.md) first — it describes the current state and
  indexes `docs/context/`. [IMPLEMENTATION.md](IMPLEMENTATION.md) is the design
  spec; check its decisions log (D1–…) before proposing architectural changes,
  and read the relevant `docs/design/` file before changing what it describes.
- Follow [docs/context/code-design.md](docs/context/code-design.md): one
  artifact per file, short files, full names, concise doc comments with the
  rationale in `docs/`.
- Any change to code, architecture, or repo layout MUST update CONTEXT.md and
  the affected `docs/context/` file in the same change set. A change worth
  remembering also gets an entry at the top of
  [docs/context/changelog.md](docs/context/changelog.md).
- NEVER run `git add`, `git commit`, or `git push` in this repo. The user
  stages and commits everything themselves. Leave the working tree dirty.
