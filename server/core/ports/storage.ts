import type { Entry } from "../domain/entry";
import type { Meta } from "../domain/meta";
import type { Scope } from "../domain/scope";
import type { Query } from "../query/query";

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
  put(e: Entry): Promise<void>;
  get(scope: Scope, collection: string, id: string): Promise<Entry>;
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

  // Instance metadata (instance_id, last_seq). seq stays instance-global and
  // monotonic across every scope.
  meta(): Promise<Meta>;

  close(): Promise<void>;
}
