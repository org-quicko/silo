/**
 * A variable as it is stored: one document per **declaration**, holding every
 * environment's value for it (D57).
 *
 * The shape follows straight from the requirement that a name is declared once
 * and valued per environment. Declaring `API_URL` in a project writes one
 * document; giving `prod` a value writes one key inside it. The alternatives
 * were a document per (variable, environment) pair — which makes resolving a
 * scope a join and makes "declared but unset here" indistinguishable from
 * "never declared" — or a document per environment holding its whole map,
 * which has no place to put the declaration itself.
 *
 * **Keyed by record id, never by name.** `project_id` is a `ProjectRecord`
 * ULID and each key of `values` is an `EnvironmentRecord` ULID, so D51's
 * renames move nothing here: renaming `prod` to `production` leaves every
 * value exactly where it was, which a name-keyed map could only manage by
 * joining the rename cascade.
 *
 * `values` holds **only environments that have been given one**. An absent key
 * is not an empty string: an empty string is a value an operator chose and
 * substitutes as empty, while an absent key leaves `{{NAME}}` standing in the
 * response and shows as unset in the admin.
 */
export interface VariableRecord {
  /** The `ProjectRecord` this name is declared in. Names are unique per project. */
  project_id: string;
  name: string;
  /** What it is for, shown beside the name. Empty when nobody wrote one. */
  description: string;
  /** `EnvironmentRecord` id to value, for the environments that have one. */
  values: Record<string, string>;
}

export class VariableRecords {
  /** The collection every declaration lives in, in `Scope.System`. */
  static readonly Collection = "_variables" as const;

  /**
   * A stored document read back as a record, tolerating anything.
   *
   * A hand-edited or imported document must not turn a page of variables into
   * a 500 — the same forgiveness `ClaimAuthorizer` extends to an unparseable
   * held claim — so every field falls back to its empty form and a `values`
   * entry that is not a string is dropped rather than substituted.
   */
  static from(data: unknown): VariableRecord {
    const source = (data ?? {}) as Record<string, unknown>;
    const values: Record<string, string> = {};
    const stored = source.values;
    if (stored && typeof stored === "object" && !Array.isArray(stored)) {
      for (const [environmentId, value] of Object.entries(stored)) {
        if (typeof value === "string") values[environmentId] = value;
      }
    }
    return {
      project_id: typeof source.project_id === "string" ? source.project_id : "",
      name: typeof source.name === "string" ? source.name : "",
      description: typeof source.description === "string" ? source.description : "",
      values,
    };
  }
}
