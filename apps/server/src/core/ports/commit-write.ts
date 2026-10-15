import type { Entry } from "../domain/entry";
import type { Scope } from "../domain/scope";
import type { DerivedIndex } from "./derived-index";

/**
 * One write inside a commit (D107), applied in order with the same rules as
 * the `Storage` method it names: `putSchema`, `put` or `delete`.
 */
export type CommitWrite =
  | { kind: "schema"; scope: Scope; collection: string; schema: unknown; id?: string }
  | { kind: "put"; entry: Entry; derived: DerivedIndex }
  | { kind: "delete"; scope: Scope; collection: string; id: string };
