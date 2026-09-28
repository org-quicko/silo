import { ValidationError } from "../errors/validation-error";
import { HookNames } from "../hooks/hook-names";
import type { HookName } from "../hooks/hook-name";
import type { Claim } from "./claim";
import type { HookClaim } from "./hook-claim";
import type { ClaimPreset } from "./claim-preset";
import { ClaimSegment } from "./claim-segment";
import { ClaimVocabulary } from "./claim-vocabulary";
import type { CollectionClaim } from "./collection-claim";
import { CollectionName } from "./collection-name";
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
  /** Project and env ids use this — since D19 they are literal segments of a
   *  collection claim. A collection's segment is longer (D104). */
  static readonly IdSegment = "[a-z][a-z0-9_-]{0,63}";

  /** A collection name as a claim segment: `CollectionName`'s rule, so every
   *  name a collection may have can be named in a claim. */
  static readonly CollectionSegment = CollectionName.Segment;

  /**
   * A prefix pattern: at least `ClaimSegment.MinimumPrefix` literal characters
   * of an id, then `*` (D64).
   *
   * The floor lives in the grammar rather than in a check after it, so an
   * under-length prefix is *unknown grammar* — the same refusal an invented
   * claim gets — rather than a valid-looking claim rejected by a second rule
   * somewhere else. A trailing `*` is the only position a pattern may take;
   * `ClaimSegment` says why.
   */
  static readonly PrefixSegment = ClaimGrammar.prefix(64);

  /** The same, for the collection segment, which is as long as a name may be. */
  static readonly CollectionPrefixSegment = ClaimGrammar.prefix(CollectionName.MaxLength);

  /** Any of the three spellings a scope segment may take. Ordered so the
   *  pattern is tried before the bare id, which would otherwise match its
   *  literal part and leave the `*` to fail the rest of the expression. */
  private static readonly Segment =
    `(?:\\*|${ClaimGrammar.PrefixSegment}|${ClaimGrammar.IdSegment})`;

  /** The collection segment's three spellings, in the same order. */
  private static readonly CollectionSegmentAny =
    `(?:\\*|${ClaimGrammar.CollectionPrefixSegment}|${ClaimGrammar.CollectionSegment})`;

  private static readonly NamePattern = new RegExp(`^${ClaimGrammar.IdSegment}$`);

  private static readonly CollectionPattern = new RegExp(
    `^collections:(${ClaimGrammar.Segment})\\/(${ClaimGrammar.Segment})\\/(${ClaimGrammar.CollectionSegmentAny}):(.+)$`,
  );

  /** The same three scope segments as a collection claim; only the prefix and
   *  the trailing vocabulary differ (D34). */
  private static readonly HookPattern = new RegExp(
    `^hooks:(${ClaimGrammar.Segment})\\/(${ClaimGrammar.Segment})\\/(${ClaimGrammar.CollectionSegmentAny}):(.+)$`,
  );

  static collection(
    project: string,
    env: string,
    name: string,
    permission: CollectionPermission,
  ): CollectionClaim {
    return `collections:${project}/${env}/${name}:${permission}`;
  }

  static hook(project: string, env: string, collection: string, hook: HookName): HookClaim {
    return `hooks:${project}/${env}/${collection}:${hook}`;
  }

  static isCollectionName(name: string): boolean {
    return CollectionName.isValid(name);
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

    const hook = ClaimGrammar.HookPattern.exec(claim);
    if (hook !== null && HookNames.isHookName(hook[4])) {
      return ParsedClaim.fromHook(hook[1], hook[2], hook[3], hook[4]);
    }
    throw new ValidationError(`unknown or invalid claim "${claim}"`);
  }

  static isValid(claim: string): claim is Claim {
    if (claim === ClaimVocabulary.Root) return true;
    if (Object.hasOwn(ClaimVocabulary.FixedClaims, claim)) return true;

    const match = ClaimGrammar.CollectionPattern.exec(claim);
    if (match !== null && Object.hasOwn(ClaimVocabulary.CollectionPermissions, match[4])) {
      return true;
    }

    const hook = ClaimGrammar.HookPattern.exec(claim);
    return hook !== null && HookNames.isHookName(hook[4]);
  }

  static isPreset(value: string): value is ClaimPreset {
    return Object.hasOwn(ClaimVocabulary.Presets, value);
  }

  /**
   * Deduplicated and sorted, or a `ValidationError`. Root absorbs the rest —
   * a list that already grants everything says so and nothing more.
   *
   * A **retired** claim is dropped rather than refused (D58). Credentials
   * outlive releases: a key exported from an older instance still names
   * `media:read`, and refusing the list would make the whole import fail over
   * a string that now grants nothing anyway. Dropped and not kept, so the
   * record afterwards says what the key can actually do.
   */
  static normalize(value: unknown): Claim[] {
    if (!Array.isArray(value)) {
      throw new ValidationError("claims must be an array of strings");
    }

    const claims = new Set<Claim>();
    for (const raw of value) {
      if (typeof raw === "string" && Object.hasOwn(ClaimVocabulary.RetiredClaims, raw)) continue;
      if (typeof raw !== "string" || !ClaimGrammar.isValid(raw)) {
        throw new ValidationError(`unknown or invalid claim "${String(raw)}"`);
      }
      claims.add(raw);
    }

    if (claims.has(ClaimVocabulary.Root)) return [ClaimVocabulary.Root];
    return [...claims].sort();
  }

  /** A prefix of an id at most `longest` characters long: the literal part is one shorter, and `*` ends it. */
  private static prefix(longest: number): string {
    return `[a-z][a-z0-9_-]{${ClaimSegment.MinimumPrefix - 1},${longest - 2}}\\*`;
  }
}
