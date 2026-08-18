import { ValidationError } from "@silo/shared/validation-error";

/**
 * A collection lives in exactly one (project, env) pair. Projects and envs are
 * plain containers — no metadata, no registry entity (D18): a scope "exists"
 * only because content has been written under it, which is why every adapter
 * derives `listScopes()` from disk/table contents rather than consulting a
 * registry.
 *
 * The id grammar is identical to collection names
 * (`^[a-z][a-z0-9_-]{0,63}$`) and is defined once here — `Claims` is untouched
 * this phase, so this pattern is intentionally a separate copy, not a reach
 * into the claims package. Because the grammar requires a lowercase first
 * character, an id starting with `_` can never pass `Scope.of`; the single
 * reserved exception, `Scope.System`, is built through a private constructor
 * that bypasses validation entirely, exactly like `_`-prefixed collection
 * names bypass `Claims.isCollectionName` (IMPLEMENTATION.md §5.4).
 */
export class Scope {
  private static readonly IdPattern = /^[a-z][a-z0-9_-]{0,63}$/;

  readonly project: string;
  readonly env: string;

  private constructor(project: string, env: string) {
    this.project = project;
    this.env = env;
  }

  /** Validating factory for caller-supplied ids. Throws `ValidationError`. */
  static of(project: string, env: string): Scope {
    Scope.validateId(project, "project");
    Scope.validateId(env, "env");
    return new Scope(project, env);
  }

  /**
   * Validate one id on its own. Project-only and env-only operations
   * (`createProject`, `listEnvironments`, …) still have to reject a bad id at
   * the same boundary `Scope.of` guards, and reaching for `Scope.of(project,
   * "prod")` with a throwaway env to get there hard-codes an unrelated id into
   * the validation of every such call.
   */
  static validateProject(project: string): void {
    Scope.validateId(project, "project");
  }

  static validateEnv(env: string): void {
    Scope.validateId(env, "env");
  }

  private static validateId(id: unknown, label: "project" | "env"): void {
    // Check the type explicitly before testing: `RegExp.test` coerces a
    // non-string argument via `String(id)`, so e.g. a number could
    // otherwise slip through as whatever its stringified form happens to be.
    if (typeof id !== "string" || !Scope.IdPattern.test(id)) {
      throw new ValidationError(
        `invalid ${label} id ${JSON.stringify(id)}: want lowercase letter first, then [a-z0-9_-], max 64 chars`
      );
    }
  }

  /** Reserved home of instance-wide system collections (currently `_keys`). */
  static readonly System: Scope = new Scope("_system", "_system");

  /** The default scope (project: default, env: prod). */
  static readonly Default: Scope = new Scope("default", "prod");

  isSystem(): boolean {
    return this.project === Scope.System.project && this.env === Scope.System.env;
  }

  /** Stable string form for cache keys, manifest keys, and error messages. */
  key(): string {
    return `${this.project}/${this.env}`;
  }

  equals(other: Scope): boolean {
    return this.project === other.project && this.env === other.env;
  }
}
