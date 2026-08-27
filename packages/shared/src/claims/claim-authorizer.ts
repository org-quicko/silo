import type { Claim } from "./claim";
import { ClaimGrammar } from "./claim-grammar";
import { ClaimVocabulary } from "./claim-vocabulary";
import type { CollectionPermission } from "./collection-permission";
import { ParsedClaim } from "./parsed-claim";

/** A held claim list, in either of the two forms callers keep them in. */
type HeldClaims = readonly string[] | readonly ParsedClaim[];

/**
 * Answers "does this key hold that?".
 *
 * Every method tolerates an unparseable held claim by skipping it: a stored key
 * is validated when it is minted (D12), but a hand-edited or imported record
 * need not be, and one bad record must not turn every check into a 500.
 */
export class ClaimAuthorizer {
  static has(claims: HeldClaims, required: Claim | ParsedClaim): boolean {
    if (ClaimAuthorizer.holdsRoot(claims)) return true;

    let requirement: ParsedClaim;
    try {
      requirement = typeof required === "string" ? ClaimGrammar.parse(required) : required;
    } catch {
      return false;
    }

    for (const held of ClaimAuthorizer.parsed(claims)) {
      if (held.covers(requirement)) return true;
    }
    return false;
  }

  static any(claims: HeldClaims, required: readonly (Claim | ParsedClaim)[]): boolean {
    return required.some((claim) => ClaimAuthorizer.has(claims, claim));
  }

  /** Whether `permission` is held on *any* collection, optionally narrowed to
   *  one scope. */
  static hasAnyCollectionPermission(
    claims: HeldClaims,
    permission: CollectionPermission,
    project?: string,
    env?: string,
  ): boolean {
    if (ClaimAuthorizer.holdsRoot(claims)) return true;

    const scoped = project !== undefined && env !== undefined;
    for (const held of ClaimAuthorizer.parsed(claims)) {
      if (held.kind !== "collection" || held.permission !== permission) continue;
      if (!scoped || held.matchesScope(project, env)) return true;
    }
    return false;
  }

  /** Whether a key may mint another key carrying `requested` — it may grant
   *  only what it already holds. */
  static canDelegate(own: HeldClaims, requested: readonly (Claim | ParsedClaim)[]): boolean {
    if (ClaimAuthorizer.holdsRoot(own)) return true;

    const held = ClaimAuthorizer.parsed(own);
    return requested.every((required) => {
      try {
        const requirement =
          typeof required === "string" ? ClaimGrammar.parse(required) : required;
        return held.some((grant) => grant.covers(requirement));
      } catch {
        return false;
      }
    });
  }

  /** Every one of `permissions` held at `*` / `*` / `*`. */
  static hasInstanceWide(
    claims: HeldClaims,
    permissions: readonly CollectionPermission[],
  ): boolean {
    return permissions.every((permission) =>
      ClaimAuthorizer.has(claims, ClaimGrammar.collection("*", "*", "*", permission)),
    );
  }

  /**
   * Every one of `permissions` held for **all** collections of one scope.
   *
   * The scoped counterpart of {@link hasInstanceWide}: the `*` collection
   * segment is what a whole-scope operation needs, and `has` resolves it
   * through `covers`, so a wider grant — `acme`/`*`/`*`, or root — satisfies it.
   */
  static hasScopeWide(
    claims: HeldClaims,
    permissions: readonly CollectionPermission[],
    project: string,
    env: string,
  ): boolean {
    return permissions.every((permission) =>
      ClaimAuthorizer.has(claims, ClaimGrammar.collection(project, env, "*", permission)),
    );
  }

  static holdsRoot(claims: HeldClaims): boolean {
    for (const claim of claims) {
      if (typeof claim === "string" ? claim === ClaimVocabulary.Root : claim.kind === "root") {
        return true;
      }
    }
    return false;
  }

  /** The held claims that parse, in order. */
  private static parsed(claims: HeldClaims): ParsedClaim[] {
    const parsed: ParsedClaim[] = [];
    for (const claim of claims) {
      try {
        parsed.push(typeof claim === "string" ? ClaimGrammar.parse(claim) : claim);
      } catch {
        continue;
      }
    }
    return parsed;
  }
}
