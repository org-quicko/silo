import type { FieldSpec } from "./field-spec";

/** One collection's identity, access and field list. */
export interface CollectionBlueprint {
  name: string;
  title: string;
  /** `x-silo-auth` — private data an anonymous caller must not read. */
  auth?: boolean;
  fields: FieldSpec[];
}
