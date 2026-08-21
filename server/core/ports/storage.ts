import type { Entry } from "../domain/entry";
import type { Meta } from "../domain/meta";
import type { Scope } from "../domain/scope";
import type { Query } from "../query/query";
import type { MediaUsage } from "../media/media-usage";
import type { DerivedIndex } from "./derived-index";

export interface Storage {
  // Projects and Environments (D20).
  //
  // A project or env **exists** when it has been created explicitly *or*
  // still holds a schema or an entry. Both halves matter and both adapters
  // implement both: dropping the first loses explicitly created empty
  // projects (they vanish from `listScopes()`, and therefore from every
  // export); dropping the second hides scopes an import or a direct `put`
  // brought into being without ever calling `createProject`.
  //
  // Deletion is the inverse: `deleteProject`/`deleteEnvironment` remove the
  // explicit record *and* everything stored beneath it, so a deleted scope
  // stops existing under both halves of the rule at once. Deleting the last
  // env of a project leaves the project itself — it was created explicitly
  // and stays that way until `deleteProject`.
  //
  // Creating something that already exists is a no-op, not an error, and
  // deleting something that never existed is likewise. `_`-prefixed ids are
  // reserved (`Scope.System`) and are never reported by these listings.
  createProject(project: string): Promise<void>;
  listProjects(): Promise<string[]>;
  deleteProject(project: string): Promise<void>;
  createEnvironment(project: string, env: string): Promise<void>;
  listEnvironments(project: string): Promise<string[]>;
  deleteEnvironment(project: string, env: string): Promise<void>;

  // Schemas — scoped to (project, env)
  putSchema(scope: Scope, collection: string, schema: any): Promise<void>;
  getSchema(scope: Scope, collection: string): Promise<any>;
  listSchemas(scope: Scope): Promise<Map<string, any>>;
  deleteSchema(scope: Scope, collection: string): Promise<void>;

  // Entries — scoped to (project, env); put reads the scope off the entry
  // itself since the envelope is self-describing (D18).
  //
  // `collection` and `id` (put/get/delete/list), plus `project`/`env` on
  // `put` (the other methods receive an already-validated `Scope`), must be
  // safe path segments — non-empty, not "." or "..", containing none of
  // "/", "\", or a NUL byte (`EntryUtils.assertSafeSegment`). This is a port
  // contract every adapter enforces identically, not an fs-only concern:
  // import walks archive content into entries whose `id` comes from file
  // *contents*, not the trusted archive path, so an unvalidated id could
  // otherwise be steered outside its scope directory (fs) or simply diverge
  // silently from what SQLite would store as an inert string. Violations
  // raise `ValidationError`. Ids are intentionally not narrowed to ULID
  // shape — imported historical entries may carry arbitrary ids.
  //
  // `derived` carries the state the write must land atomically with (D23,
  // D30): `usages` is the entry's **complete** set of media reference tokens,
  // produced by `MediaRefs.extract` and replacing whatever the entry
  // referenced before, in the same operation as the write itself. SQLite
  // writes it inside `put`'s existing seq transaction, so an entry and its
  // references land together or not at all; the fs adapter ignores it and
  // derives usages by scanning, which is why the extractor is shared rather
  // than reimplemented per adapter. Adapters never parse reference strings
  // themselves.
  //
  // It is required rather than optional on purpose. An omitted set has no safe
  // reading — treating it as "no references" silently orphans a live file,
  // treating it as "leave them alone" silently rots the index — so a caller
  // who forgets gets a type error instead of a bug.
  //
  // `derived.search` is the same bargain for search (D30): the caller extracts
  // it because the extractor needs the collection's schema and no adapter
  // should ever have one, and `null` means "index nothing", which is what
  // system data passes. An adapter that keeps no index ignores it — the fs
  // adapter does, since its own reason to exist is rsync and git, and an
  // on-disk index would both break the frozen layout (D5) and go stale under a
  // `git checkout` beneath a running process.
  put(e: Entry, derived: DerivedIndex): Promise<void>;
  get(scope: Scope, collection: string, id: string): Promise<Entry>;
  // Drops the entry's usages as part of the same operation.
  delete(scope: Scope, collection: string, id: string): Promise<void>;
  list(scope: Scope, collection: string, q: Query): Promise<{ items: Entry[]; total: number }>;

  // Every non-system scope that exists — created explicitly or still holding
  // a schema or an entry, per the rule above — sorted by (project, env).
  listScopes(): Promise<Scope[]>;

  // Every collection in `scope` that still holds at least one entry, sorted
  // by name. Deliberately distinct from `listSchemas`: an import archive can
  // carry a `content/<collection>/` directory with no matching schema, and
  // those entries are invisible to every schema-derived listing. Without this
  // the scope they live in can never be emptied — `listScopes()` keeps
  // reporting it while a schema-driven delete finds nothing to erase.
  listEntryCollections(scope: Scope): Promise<string[]>;

  // Media usages (D23). Derived state the adapter owns and keeps consistent
  // with entries by whatever means suits it: SQLite maintains a
  // `media_references` table inside the same transactions that write and
  // delete entries; the fs adapter keeps no index at all and scans entry
  // files, which is the O(n)-per-query character §6.3 already commits it to
  // and — unlike an in-memory index — has no window in which an rsync or a
  // `git checkout` under a running process can make the answer stale.
  //
  // Both take a list of tokens because the delete guard asks about an asset's
  // catalog id and its pre-D23 `blob:<key>` form at once. `list` mirrors
  // `Storage.list`'s `{items, total}` so a 409 gets its count and its
  // enumerable page from one call; `count` exists so a library page can show
  // usage for many assets without one query each.
  listMediaUsages(
    mediaIds: string[],
    opts?: { limit?: number; offset?: number }
  ): Promise<{ items: MediaUsage[]; total: number }>;
  countMediaUsages(mediaIds: string[]): Promise<Map<string, number>>;

  // Instance metadata (instance_id, last_seq). seq stays instance-global and
  // monotonic across every scope.
  meta(): Promise<Meta>;

  close(): Promise<void>;
}
