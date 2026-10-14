import type { Entry } from "../../domain/entry";
import type { Scope } from "../../domain/scope";
import type { PackagedEntry } from "../package/packaged-entry";

/**
 * What `TransferPlanner` plans from (D110): a verified package, read through
 * `content` by collection and id, and the options fixed when it was prepared.
 * The package's own scope never appears: its content lands in `to`.
 */
export interface TransferPlanInput {
  to: Scope;
  mode: "merge" | "replace";
  prefer?: "local" | "remote";
  /** The source instance, for the last tie-break of `ImportRules.incomingWins`. */
  instanceId: string;
  /** The selected collections. */
  collections: readonly string[];
  /** Every packaged entry, as the verifier counted them. */
  entries: readonly PackagedEntry[];
  content: {
    schema(collection: string): Promise<unknown>;
    /** The entry file as the package holds it, dates still strings. */
    entry(collection: string, id: string): Promise<Entry | null>;
  };
}
