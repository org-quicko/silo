import type { PluginApiOperation } from "./plugin-api-operation";

/**
 * The typed client a plugin gets over `ctx.fetch`, described once (D35).
 *
 * Before this, the plugin-facing surface was mirrored **by hand in three
 * places** — the host's method switch, the worker bootstrap that called it, and
 * the `silo:api` declarations that typed it — and nothing but review kept them
 * in step. This is the one place, and both of the other two are emitted from
 * it: `PluginClientSource` builds the worker's implementation at start, and
 * `PluginTypesSource` builds the declarations that ship to plugin authors.
 *
 * It is a **convenience, not a boundary.** Every method below is a path that
 * `ctx.fetch` could reach spelled out by hand, so nothing here grants anything
 * and leaving a route out denies nothing. Authority is the granted claim set
 * and the route guard, both unchanged and both somewhere else. That is what
 * makes the list a matter of taste rather than of security, and why it covers
 * what a plugin reaches for often instead of all thirty routes.
 *
 * The field names are the **HTTP API's own**, wart for wart: entries and search
 * page under `data`, media and collections under `items`. Smoothing that over
 * here would cost the property the design is for — the same client running
 * against a remote silo over a real socket — for a cosmetic gain the API itself
 * can make later, once, for everybody.
 */
export class PluginApiContract {
  private static readonly Scoped = "/api/projects/{project}/environments/{env}";

  static readonly Operations: readonly PluginApiOperation[] = [
    {
      name: "entries.list",
      method: "GET",
      path: `${PluginApiContract.Scoped}/collections/{collection}`,
      parameters: [
        { name: "scope", kind: "scope", type: "SiloScope" },
        { name: "collection", kind: "path", type: "string" },
        { name: "query", kind: "query", type: "SiloQuery", optional: true },
      ],
      returns: "SiloPage",
      summary: "A page of entries. `limit`, `offset`, `filter` and `sort` are the query's keys.",
    },
    {
      name: "entries.get",
      method: "GET",
      path: `${PluginApiContract.Scoped}/collections/{collection}/{id}`,
      parameters: [
        { name: "scope", kind: "scope", type: "SiloScope" },
        { name: "collection", kind: "path", type: "string" },
        { name: "id", kind: "path", type: "string" },
      ],
      returns: "any",
      summary: "One entry, with media references expanded exactly as the API expands them.",
    },
    {
      name: "entries.create",
      method: "POST",
      path: `${PluginApiContract.Scoped}/collections/{collection}`,
      parameters: [
        { name: "scope", kind: "scope", type: "SiloScope" },
        { name: "collection", kind: "path", type: "string" },
        { name: "data", kind: "body", type: "any" },
      ],
      returns: "any",
      summary: "Create an entry. Validated against the collection's schema, like any write.",
    },
    {
      name: "entries.update",
      method: "PUT",
      path: `${PluginApiContract.Scoped}/collections/{collection}/{id}`,
      parameters: [
        { name: "scope", kind: "scope", type: "SiloScope" },
        { name: "collection", kind: "path", type: "string" },
        { name: "id", kind: "path", type: "string" },
        { name: "data", kind: "body", type: "any" },
        { name: "rev", kind: "rev", type: "number" },
      ],
      returns: "any",
      summary: "Replace an entry. `rev` is required — a blind write is not offered.",
    },
    {
      name: "entries.delete",
      method: "DELETE",
      path: `${PluginApiContract.Scoped}/collections/{collection}/{id}`,
      parameters: [
        { name: "scope", kind: "scope", type: "SiloScope" },
        { name: "collection", kind: "path", type: "string" },
        { name: "id", kind: "path", type: "string" },
        { name: "rev", kind: "rev", type: "number" },
      ],
      returns: "void",
      summary: "Delete an entry.",
    },
    {
      name: "entries.search",
      method: "GET",
      path: `${PluginApiContract.Scoped}/collections/{collection}/search`,
      parameters: [
        { name: "scope", kind: "scope", type: "SiloScope" },
        { name: "collection", kind: "path", type: "string" },
        { name: "query", kind: "query", type: "SiloQuery" },
      ],
      returns: "SiloPage",
      summary: "Full-text search within one collection. `q` is the query text.",
    },
    {
      name: "collections.list",
      method: "GET",
      path: `${PluginApiContract.Scoped}/collections`,
      parameters: [{ name: "scope", kind: "scope", type: "SiloScope" }],
      returns: "SiloItemPage",
      summary: "The collections of one scope that the grant can see.",
    },
    {
      name: "collections.schema",
      method: "GET",
      path: `${PluginApiContract.Scoped}/collections/{collection}/schema`,
      parameters: [
        { name: "scope", kind: "scope", type: "SiloScope" },
        { name: "collection", kind: "path", type: "string" },
      ],
      returns: "any",
      summary: "One collection's JSON Schema, for a plugin that validates against it.",
    },
    {
      name: "projects.list",
      method: "GET",
      path: "/api/projects",
      parameters: [],
      returns: "SiloItemPage",
      summary: "The projects the grant can see, each with its environments.",
    },
    {
      name: "media.list",
      method: "GET",
      path: "/api/media",
      parameters: [{ name: "query", kind: "query", type: "SiloQuery", optional: true }],
      returns: "SiloItemPage",
      summary: "A page of the media catalog. Media is instance-global, so this takes no scope.",
    },
    {
      name: "media.get",
      method: "GET",
      path: "/api/media/{id}",
      parameters: [{ name: "id", kind: "path", type: "string" }],
      returns: "any",
      summary: "One media asset's metadata. The bytes are not reachable through `ctx`.",
    },
  ];

  /** The operations of one group, in contract order — which is the order they
   *  are emitted in, so a regenerated client diffs cleanly. */
  static group(name: string): readonly PluginApiOperation[] {
    return PluginApiContract.Operations.filter((operation) => PluginApiContract.groupOf(operation) === name);
  }

  /** Every group, first-seen order. */
  static groups(): readonly string[] {
    return [...new Set(PluginApiContract.Operations.map(PluginApiContract.groupOf))];
  }

  static groupOf(operation: PluginApiOperation): string {
    return operation.name.split(".")[0]!;
  }

  static methodOf(operation: PluginApiOperation): string {
    return operation.name.split(".")[1]!;
  }
}
