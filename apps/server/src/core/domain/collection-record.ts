/**
 * A collection as a keyed record (D51) — the row that replaced the `schemas`
 * table rather than joining it.
 *
 * `schema` is never null: a collection cannot exist without one, so `putSchema`
 * is the only thing that brings a row into being. Both parents are held by id,
 * denormalised rather than reached through `env_id` alone, because every
 * scope-level query would otherwise need two joins and a rename touches neither
 * column.
 */
export interface CollectionRecord {
  id: string;
  project_id: string;
  env_id: string;
  name: string;
  schema: any;
  created_at: Date;
  updated_at: Date;
}
