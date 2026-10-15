import type { Scope } from "../domain/scope";

/**
 * Something a commit requires of the store before it writes anything (D107).
 *
 * Each is a statement about what was observed when the change set was planned,
 * checked again inside the commit's own transaction, so nothing can change in
 * between. `seq` is the version stamp: every write assigns a new one.
 *
 * - `entry`: the row has this `seq`, or is absent when `seq` is `null`.
 * - `collection`: the record has this id and `updated_at`, or is absent.
 * - `entries`: the collection holds exactly these rows, at these `seq`s.
 */
export type CommitPrecondition =
  | { kind: "entry"; scope: Scope; collection: string; id: string; seq: number | null }
  | {
      kind: "collection";
      scope: Scope;
      collection: string;
      record: { id: string; updatedAt: string } | null;
    }
  | {
      kind: "entries";
      scope: Scope;
      collection: string;
      rows: readonly { id: string; seq: number }[];
    };
