import { ValidationError } from "../errors/validation-error";
import type { Claim } from "./claim";
import type { ClaimPreset } from "./claim-preset";
import { ClaimVocabulary } from "./claim-vocabulary";
import type { CollectionClaim } from "./collection-claim";
import type { CollectionPermission } from "./collection-permission";
import type { FixedClaim } from "./fixed-claim";
import { ParsedClaim } from "./parsed-claim";

/**
 * The claim string grammar: how one is spelled, whether it is well formed, and
 * what it parses to.
 *
 * There is exactly one parser of this grammar. A second would be a second
 * enforcement point that can disagree with the first.
 */
export class ClaimGrammar {
  /** Project, env and collection ids all use this — since D19 they are literal
   *  segments of a collection claim. */
  static readonly IdSegment = "[a-z][a-z0-9_-]{0,63}";

  private static readonly NamePattern = new RegExp(`^${ClaimGrammar.IdSegment}$`);

  private static readonly CollectionPattern = new RegExp(
    `^collections:(\\*|${ClaimGrammar.IdSegment})\\/(\\*|${ClaimGrammar.IdSegment})\\/(\\*|${ClaimGrammar.IdSegment}):(.+)$`,
  );

  static collection(
    project: string,
    env: string,
    name: string,
    permission: CollectionPermission,
  ): CollectionClaim {
    return `collections:${project}/${env}/${name}:${permission}`;
  }

  static isCollectionName(name: string): boolean {
    return ClaimGrammar.NamePattern.test(name);
  }

  /**
   * The server's `Scope` value object keeps its own copy as the authority at
   * the storage boundary; this exists so the UI can reject a bad id before
   * issuing a request rather than restating the regex a third time.
   */
  static isScopeId(id: string): boolean {
    return ClaimGrammar.NamePattern.test(id);
  }

  static parse(claim: string): ParsedClaim {
    if (claim === ClaimVocabulary.Root) return ParsedClaim.root();

    if (Object.hasOwn(ClaimVocabulary.FixedClaims, claim)) {
      return ParsedClaim.fromFixed(claim as FixedClaim);
    }

    const match = ClaimGrammar.CollectionPattern.exec(claim);
    if (match !== null && Object.hasOwn(ClaimVocabulary.CollectionPermissions, match[4])) {
      return ParsedClaim.fromCollection(
        match[1],
        match[2],
        match[3],
        match[4] as CollectionPermission,
      );
    }
    throw new ValidationError(`unknown or invalid claim "${claim}"`);
  }

  static isValid(claim: string): claim is Claim {
    if (claim === ClaimVocabulary.Root) return true;
    if (Object.hasOwn(ClaimVocabulary.FixedClaims, claim)) return true;

    const match = ClaimGrammar.CollectionPattern.exec(claim);
    return match !== null && Object.hasOwn(ClaimVocabulary.CollectionPermissions, match[4]);
  }

  static isPreset(value: string): value is ClaimPreset {
    return Object.hasOwn(ClaimVocabulary.Presets, value);
  }

  /** Deduplicated and sorted, or a `ValidationError`. Root absorbs the rest —
   *  a list that already grants everything says so and nothing more. */
  static normalize(value: unknown): Claim[] {
    if (!Array.isArray(value)) {
      throw new ValidationError("claims must be an array of strings");
    }

    const claims = new Set<Claim>();
    for (const raw of value) {
      if (typeof raw !== "string" || !ClaimGrammar.isValid(raw)) {
        throw new ValidationError(`unknown or invalid claim "${String(raw)}"`);
      }
      claims.add(raw);
    }

    if (claims.has(ClaimVocabulary.Root)) return [ClaimVocabulary.Root];
    return [...claims].sort();
  }
}
