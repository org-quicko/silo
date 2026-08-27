import type { Entry } from "../domain/entry";
import type { Meta } from "../domain/meta";
import type { Scope } from "../domain/scope";
import type { Query } from "../query/query";
import type { MediaUsage } from "../media/media-usage";
import type { DerivedIndex } from "./derived-index";

/**
 * Where entries, schemas and scopes live.
 *
 * Two adapters implement this — SQLite and the filesystem — and the
 * conformance suite is the contract: both must answer every question the same
 * way. See `docs/design/storage.md` for the rules behind the shape, including
 * scope existence (D20), the path-segment contract, and why `derived` is
 * required rather than optional.
 */
export interface Storage {
  // ---- Projects and environments (D20) ----
  //
  // A project or env **exists** when it was created explicitly *or* still
  // holds a schema or an entry. Creating one that exists is a no-op, as is
  // deleting one that never did. `_`-prefixed ids are reserved
  // (`Scope.System`) and never appear in these listings.

  createProject(project: string): Promise<void>;
  listProjects(): Promise<string[]>;
  /** Removes the explicit record *and* everything stored beneath it. */
  deleteProject(project: string): Promise<void>;

  createEnvironment(project: string, env: string): Promise<void>;
  listEnvironments(project: string): Promise<string[]>;
  deleteEnvironment(project: string, env: string): Promise<void>;

  // ---- Schemas, scoped to (project, env) ----

  putSchema(scope: Scope, collection: string, schema: any): Promise<void>;
  getSchema(scope: Scope, collection: string): Promise<any>;
  listSchemas(scope: Scope): Promise<Map<string, any>>;
  deleteSchema(scope: Scope, collection: string): Promise<void>;

  // ---- Entries ----
  //
  // `collection` and `id` — and `project`/`env` on `put`, which reads the
  // scope off the self-describing envelope (D18) — must be safe path segments
  // (`EntryUtils.assertSafeSegment`). Every adapter enforces this identically:
  // an import takes an entry's id from file *contents*, not from the trusted
  // archive path.

  /** `derived` carries the state that must land atomically with the write
   *  (D23, D30): the entry's complete media reference set, and its index text.
   *  Required, not optional — an omitted set has no safe reading. */
  put(entry: Entry, derived: DerivedIndex): Promise<void>;
  get(scope: Scope, collection: string, id: string): Promise<Entry>;
  /** Drops the entry's usages as part of the same operation. */
  delete(scope: Scope, collection: string, id: string): Promise<void>;
  list(
    scope: Scope,
    collection: string,
    query: Query
  ): Promise<{ items: Entry[]; total: number }>;

  /** Every non-system scope that exists, sorted by (project, env). */
  listScopes(): Promise<Scope[]>;

  /**
   * Every collection in `scope` that still holds at least one entry.
   *
   * Deliberately distinct from `listSchemas`: an archive can carry a
   * `content/<collection>/` directory with no matching schema, and without
   * this the scope those entries live in could never be emptied.
   */
  listEntryCollections(scope: Scope): Promise<string[]>;

  // ---- Media usages (D23) ----
  //
  // Derived state the adapter owns and keeps consistent with entries by
  // whatever means suits it — an indexed table, or a scan. Both methods take a
  // list of tokens because the delete guard asks about an asset's catalog id
  // and its pre-D23 `blob:<key>` form at once.

  /** Mirrors `list`'s `{items, total}` so a 409 gets its count and its
   *  enumerable page from one call. */
  listMediaUsages(
    mediaIds: string[],
    page?: { limit?: number; offset?: number }
  ): Promise<{ items: MediaUsage[]; total: number }>;

  /** Counts for many assets at once, so a library page needs one query. */
  countMediaUsages(mediaIds: string[]): Promise<Map<string, number>>;

  /** Instance id and `last_seq`. `seq` is instance-global and monotonic
   *  across every scope. */
  meta(): Promise<Meta>;

  close(): Promise<void>;
}
