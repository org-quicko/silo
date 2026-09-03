import type { ProviderPort } from "./plugin-contract";

/** One method of a port, as the scaffold emits it. */
export interface PortMethod {
  name: string;
  params: string;
  note: string;
}

/**
 * The two ports a provider plugin may implement (§13.7), as method lists.
 *
 * **Names and parameters only, with no types**, and that is not laziness: the
 * `silo:api` virtual module carries the extension surface and nothing else, so
 * `Storage`, `BlobStorage`, `Entry`, `Scope`, `Query` and `DerivedIndex` have
 * no published declarations for a plugin author to import. §12.8 is where
 * `@silo/plugin-types` and `@silo/conformance` land; until then a provider is
 * written against `apps/server/src/core/ports/` in the silo repo, and a scaffold that
 * pretended otherwise by inventing its own copies of the domain types would be
 * shipping a second, silently diverging contract.
 *
 * So this is a *checklist that compiles*: every method, in port order, with
 * the one sentence about each that the signature cannot carry.
 * `test/provider-ports-drift.test.ts` reads the real interfaces and asserts
 * this list is neither missing a method nor inventing one.
 */
export class ProviderPorts {
  static readonly Storage: readonly PortMethod[] = [
    {
      name: "createProject",
      params: "name, id?",
      note: "returns the record; existing name keeps its id, so `id` is import's to preserve",
    },
    { name: "listProjects", params: "", note: "returns ProjectRecord[], sorted by name" },
    { name: "findProject", params: "name", note: "null when absent" },
    { name: "renameProject", params: "id, name", note: "by **id**; refuses a collision" },
    { name: "deleteProject", params: "name", note: "removes the record and everything beneath it" },
    { name: "createEnvironment", params: "project, env, id?", note: "returns the record" },
    { name: "listEnvironments", params: "project", note: "returns EnvironmentRecord[]" },
    { name: "findEnvironment", params: "project, env", note: "null when absent" },
    { name: "renameEnvironment", params: "id, name", note: "by **id**; refuses a collision" },
    { name: "deleteEnvironment", params: "project, env", note: "" },
    {
      name: "listCollections",
      params: "scope",
      note: "returns CollectionRecord[] — the authority on what exists",
    },
    { name: "findCollection", params: "scope, collection", note: "null when absent" },
    { name: "renameCollection", params: "id, name", note: "by **id**; refuses a collision" },
    {
      name: "putSchema",
      params: "scope, collection, schema, id?",
      note: "the ONLY thing that creates a collection — its schema is never null",
    },
    { name: "getSchema", params: "scope, collection", note: "" },
    {
      name: "deleteSchema",
      params: "scope, collection",
      note: "removes the whole collection record; refuses while entries remain",
    },
    {
      name: "put",
      params: "entry, derived",
      note: "`derived` must land in the SAME transaction as the entry (D23, D30)",
    },
    { name: "get", params: "scope, collection, id", note: "throws NotFoundError when absent" },
    { name: "delete", params: "scope, collection, id", note: "drops the entry's media usages too" },
    { name: "list", params: "scope, collection, query", note: "returns { items, total }" },
    {
      name: "countEntries",
      params: "scope",
      note: "Map<collection name, entry count>; absent means zero, so read it with ?? 0",
    },
    { name: "listScopes", params: "", note: "sorted by (project, env); never system scopes" },
    {
      name: "listEntryCollections",
      params: "scope",
      note: "which collections hold entries — no longer how existence is decided",
    },
    {
      name: "listMediaUsages",
      params: "mediaIds, opts",
      note: "returns { items, total }; ordered by scope NAME, resolved before the page is cut",
    },
    { name: "countMediaUsages", params: "mediaIds", note: "returns a Map<string, number>" },
    {
      name: "meta",
      params: "",
      note: "{ instance_id, last_seq, defaults_initialized } — seq is instance-global and monotonic",
    },
    { name: "markDefaultsInitialized", params: "", note: "idempotent" },
    { name: "close", params: "", note: "" },
  ];

  static readonly Blob: readonly PortMethod[] = [
    { name: "put", params: "key, data, options", note: "`data` is a Uint8Array" },
    { name: "get", params: "key", note: "returns { data, contentType, size } or null" },
    { name: "delete", params: "key", note: "" },
    { name: "list", params: "prefix", note: "returns BlobItem[]" },
    { name: "exists", params: "key", note: "" },
    { name: "close", params: "", note: "optional on the port; kept here so teardown has a home" },
  ];

  static for(port: ProviderPort): readonly PortMethod[] {
    return port === "storage" ? ProviderPorts.Storage : ProviderPorts.Blob;
  }

  /** Where the real interface lives, quoted into the generated file so an
   *  author has somewhere to go the moment the checklist is not enough. */
  static source(port: ProviderPort): string {
    return port === "storage"
      ? "apps/server/src/core/ports/storage.ts"
      : "apps/server/src/core/ports/blob-storage.ts";
  }
}
