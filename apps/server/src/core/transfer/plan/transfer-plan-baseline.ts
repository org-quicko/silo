import type { Entry } from "../../domain/entry";
import type { TransferPlanLine } from "./transfer-plan-line";

/** A destination row as a plan line records it (D110): the `seq` Apply checks, and what the review shows. */
export class TransferPlanBaseline {
  static of(entry: Entry): NonNullable<TransferPlanLine["destination"]> {
    return { seq: entry.seq, rev: entry.rev, updated_at: entry.updated_at.toISOString() };
  }
}
