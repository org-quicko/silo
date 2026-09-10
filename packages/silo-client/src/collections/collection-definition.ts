import type { JsonSchema } from "./json-schema.js";

/** One collection with its schema, bundled so `silo://` refs are already
 * resolved. What `create`, `schema.get()`, `schema.put()` and
 * `environment.schemas()` all answer. No mapping needed: every key here is
 * already the wire's own spelling. */
export interface CollectionDefinition {
  readonly id: string;
  readonly name: string;
  readonly schema: JsonSchema;
}
