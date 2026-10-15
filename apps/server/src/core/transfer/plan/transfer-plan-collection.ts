import type { SchemaDecision } from "../import-rules";

/**
 * One selected collection of a transfer's plan (D110): what happens to its
 * schema, its counts, and the baseline Apply checks before writing.
 *
 * The counts follow the importer's, so a transfer and an env copy of the same
 * content read the same: replace counts every destination row as `deleted`,
 * whether it is overwritten or removed.
 */
export interface TransferPlanCollection {
  collection: string;
  schema: SchemaDecision["action"];
  added: number;
  updated: number;
  deleted: number;
  skipped: number;
  rejected: number;
  baseline: {
    /** The destination's collection record, or null when the plan creates it. */
    record: { id: string; updated_at: string } | null;
    /**
     * What the collection must hold at Apply, beyond each line's own row:
     * `listed`, exactly the rows the plan's lines name (replace); `none`, no
     * rows at all (a schema change that the guard let through because the
     * collection was empty, D70).
     */
    rows?: "listed" | "none";
  };
}
