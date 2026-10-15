## 1.6.0

- `silo.trash` lists, reads, restores and purges the trash of a silo 1.6.0
  server.
- `delete()` on an entry or a media asset returns the trash item's id, or
  `null` when nothing was kept.
- A restore drops every cached entry read, since it can bring entries back to
  any collection.
- The version jumps to 1.6.0 to match the silo release that adds the trash.

## 1.0.0

- First release.
