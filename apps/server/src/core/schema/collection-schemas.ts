import type { CollectionRecord } from "../domain/collection-record";

/**
 * Collection records as the `name -> schema` map the validator and the
 * bundler work in.
 *
 * `listSchemas` used to answer this shape directly. Since D51 the port answers
 * records, and the callers that genuinely want a lookup by name build one here
 * rather than each writing the same two lines.
 */
export class CollectionSchemas {
  static map(records: readonly CollectionRecord[]): Map<string, any> {
    return new Map(records.map((record) => [record.name, record.schema]));
  }
}
