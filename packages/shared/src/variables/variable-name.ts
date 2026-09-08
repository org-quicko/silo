import { ValidationError } from "../errors/validation-error";

/**
 * What a variable may be called (D57).
 *
 * Deliberately **not** the scope/collection grammar. Those ids become path
 * segments, claim segments and directory names, so they are lowercase and
 * allow `-`; a variable name is never any of those — it appears only inside
 * `{{…}}` in content and as a JSON key — and the convention every operator
 * already has for an environment variable is `UPPER_SNAKE`. Allowing `-` would
 * also make the template grammar ambiguous next to ordinary prose.
 *
 * Case is preserved and **significant**: `{{apiUrl}}` and `{{API_URL}}` are two
 * names. Folding them would mean two declarations could collide after the fact,
 * and a lookup that "nearly" matches is worse than one that plainly does not.
 */
export class VariableName {
  /** Shares the 64-character ceiling with every other name in silo. */
  static readonly Pattern = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

  static isValid(name: unknown): name is string {
    return typeof name === "string" && VariableName.Pattern.test(name);
  }

  /** Throws `ValidationError` naming the grammar, the way `Scope` does. */
  static assert(name: unknown): asserts name is string {
    if (!VariableName.isValid(name)) {
      throw new ValidationError(
        `invalid variable name ${JSON.stringify(name)}: want a letter or "_" first, then [A-Za-z0-9_], max 64 chars`,
      );
    }
  }
}
