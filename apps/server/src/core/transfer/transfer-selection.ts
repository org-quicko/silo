import { Claims } from "@silo/shared/claims";
import { ValidationError } from "@silo/shared/validation-error";
import { Scope } from "../domain/scope";
import type { TransferInclude } from "./transfer-include";

/**
 * What a transfer covers: a set of `project[/env[/collection]]` rules, or
 * nothing at all, which means the whole instance.
 *
 * One vocabulary for all three operations — export writes only what it
 * matches, import loads only what it matches, copy forwards it to the source's
 * export so the source never builds what will be discarded. See §7.6 in
 * [docs/design/transfer.md](../../../../../docs/design/transfer.md).
 */
export class TransferSelection {
  private readonly includes: readonly TransferInclude[];

  private constructor(includes: readonly TransferInclude[]) {
    this.includes = includes;
  }

  /** The whole instance — every scope, every collection. */
  static readonly Everything = new TransferSelection([]);

  /**
   * Parse the wire form: one `project`, `project/env` or
   * `project/env/collection` per value.
   *
   * Every id is validated here, before any storage read, so a malformed rule
   * cannot half-export. An empty list answers `Everything` rather than "nothing
   * matches", because an absent selection and an empty one arrive
   * indistinguishably over a query string.
   */
  static parse(values: readonly string[]): TransferSelection {
    if (values.length === 0) return TransferSelection.Everything;

    const includes: TransferInclude[] = [];
    const seen = new Set<string>();
    for (const value of values) {
      const include = TransferSelection.parseOne(value);
      const key = TransferSelection.key(include);
      if (seen.has(key)) throw new ValidationError(`duplicate selection "${key}"`);
      seen.add(key);
      includes.push(include);
    }
    return new TransferSelection(includes);
  }

  /** The same rules from an already-structured body, as `/api/copy` sends them. */
  static of(includes: readonly TransferInclude[]): TransferSelection {
    return TransferSelection.parse(includes.map((include) => TransferSelection.key(include)));
  }

  private static parseOne(value: unknown): TransferInclude {
    if (typeof value !== "string" || value.length === 0) {
      throw new ValidationError("each selection must be a non-empty string");
    }
    const parts = value.split("/");
    if (parts.length > 3 || parts.some((part) => part.length === 0)) {
      throw new ValidationError(
        `invalid selection "${value}": want project, project/env or project/env/collection`
      );
    }
    const [project, env, collection] = parts as [string, string?, string?];
    Scope.validateProject(project);
    if (env !== undefined) Scope.validateEnv(env);
    if (collection !== undefined) {
      // System collections are never selectable. What rides from `_system` is
      // decided by the media mode and by `with_keys`, not by a name an operator
      // can type — a selection that could name `_keys` would be a second,
      // unguarded way past the keys claim.
      if (!Claims.isCollectionName(collection) || collection.startsWith("_")) {
        throw new ValidationError(`invalid selected collection "${collection}"`);
      }
    }
    return { project, ...(env ? { env } : {}), ...(collection ? { collection } : {}) };
  }

  private static key(include: TransferInclude): string {
    return [include.project, include.env, include.collection].filter(Boolean).join("/");
  }

  /** No rules: everything is in. */
  get isEverything(): boolean {
    return this.includes.length === 0;
  }

  /** Whether any rule reaches into this project at all. */
  coversProject(project: string): boolean {
    return this.isEverything || this.includes.some((include) => include.project === project);
  }

  /** Whether any rule reaches into this (project, env) pair. */
  coversScope(scope: Scope): boolean {
    if (this.isEverything) return true;
    return this.includes.some(
      (include) =>
        include.project === scope.project &&
        (include.env === undefined || include.env === scope.env)
    );
  }

  /** Whether this exact collection is in. */
  coversCollection(scope: Scope, collection: string): boolean {
    if (this.isEverything) return true;
    return this.includes.some(
      (include) =>
        include.project === scope.project &&
        (include.env === undefined || include.env === scope.env) &&
        (include.collection === undefined || include.collection === collection)
    );
  }

  /** The rules as the manifest records them and the wire re-sends them,
   *  sorted so two equivalent selections describe themselves identically. */
  describe(): string[] {
    return this.includes.map((include) => TransferSelection.key(include)).sort();
  }

  /** The structured form, for a JSON body. */
  toIncludes(): TransferInclude[] {
    return this.includes.map((include) => ({ ...include }));
  }
}
