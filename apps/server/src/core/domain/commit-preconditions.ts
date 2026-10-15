/** A collection record as a `collection` precondition names it. */
type RecordStamp = { id: string; updatedAt: string } | null;

/** A collection's rows as an `entries` precondition names them. */
type Rows = readonly { id: string; seq: number }[];

/**
 * Whether what a store observes matches what a commit requires (D107).
 *
 * Shared so every adapter answers the same way. Each adapter only reads the
 * current state, inside its own transaction, and asks here.
 */
export class CommitPreconditions {
  static recordHolds(expected: RecordStamp, observed: RecordStamp): boolean {
    if (expected === null || observed === null) return expected === observed;
    return expected.id === observed.id && expected.updatedAt === observed.updatedAt;
  }

  /** The same ids at the same `seq`s, in whatever order either side listed them. */
  static rowsHold(expected: Rows, observed: Rows): boolean {
    if (expected.length !== observed.length) return false;
    if (new Set(expected.map((row) => row.id)).size !== expected.length) return false;
    const seqs = new Map(observed.map((row) => [row.id, row.seq]));
    return expected.every((row) => seqs.get(row.id) === row.seq);
  }
}
