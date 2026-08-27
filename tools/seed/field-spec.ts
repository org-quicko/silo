export type FieldKind =
  | "title" | "slug" | "line" | "body" | "choice" | "int" | "decimal" | "bool"
  | "date" | "future" | "person" | "email" | "url" | "tags" | "object" | "objects";

/**
 * One field, described once. Both the JSON Schema and the values are derived
 * from this, which is what keeps generated entries valid against the schema
 * that was generated beside them — two hand-written halves drift the first time
 * a field changes, and the drift shows up as a `400` mid-run.
 */
export interface FieldSpec {
  name: string;
  kind: FieldKind;
  /** Required in the schema, and therefore never omitted from an entry. */
  required?: boolean;
  /** Weighted in the search index via `x-silo-search.label`. */
  label?: boolean;
  /** Kept out of the search index via `x-silo-search.exclude`. */
  secret?: boolean;
  choices?: readonly string[];
  min?: number;
  max?: number;
  /** Paragraphs for `body`, members for `tags`/`objects`. */
  size?: number;
  fields?: FieldSpec[];
}
