/**
 * The values one scope resolves `{{NAME}}` through (D57).
 *
 * `MediaLinks`' counterpart, and deliberately the same shape of object:
 * **synchronous**, built once per response before the mapping starts, because
 * `EntryUtils.toApiResponse` is a pure function every route calls inside a
 * `map`. Anything this needs from storage is read by `VariableService` on the
 * way in, never from inside here.
 *
 * Like `MediaLinks` it distinguishes three states rather than two, for the same
 * reason. **Undeclared** — no such variable in this project — leaves the
 * reference spelled. **Declared and unset here** — the project declares it and
 * this environment has given it no value — also leaves it spelled, because
 * blanking the text would silently delete content on the way out and an
 * operator would have no way to see which environment was missing a value.
 * **Set** substitutes, including when the value is the empty string, which is
 * a choice an operator made and not an absence.
 */
export class VariableValues {
  private readonly values: Map<string, string>;
  /** Every name the project declares, set or not — what makes "declared and
   *  unset" answerable rather than collapsing into "undeclared". */
  private readonly declared: Set<string>;

  private constructor(values: Map<string, string>, declared: Set<string>) {
    this.values = values;
    this.declared = declared;
  }

  /** Nothing declared: every reference passes through. What a scope with no
   *  variables resolves through, and what a test wants. */
  static readonly Empty: VariableValues = new VariableValues(new Map(), new Set());

  static of(values: Map<string, string>, declared: Iterable<string>): VariableValues {
    return new VariableValues(values, new Set(declared));
  }

  /** `undefined` means "leave the reference alone" — see the class comment for
   *  the two different reasons that happens. */
  valueOf(name: string): string | undefined {
    return this.values.get(name);
  }

  isDeclared(name: string): boolean {
    return this.declared.has(name);
  }

  /** Whether any substitution is possible at all, so a walk can be skipped. */
  get isEmpty(): boolean {
    return this.values.size === 0;
  }

  /** Bound to `this`, so it can be handed straight to `VariableTemplate.render`. */
  readonly lookup = (name: string): string | undefined => this.values.get(name);
}
