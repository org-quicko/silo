import type { AccessLevel } from "./access-level";
import { ClaimAuthorizer } from "./claim-authorizer";
import { ClaimGrammar } from "./claim-grammar";
import { ClaimPresets } from "./claim-presets";
import { ClaimSummary } from "./claim-summary";
import { ClaimVocabulary } from "./claim-vocabulary";
import type { Claim } from "./claim";
import type { ClaimPreset } from "./claim-preset";
import type { CollectionClaim } from "./collection-claim";
import type { CollectionPermission } from "./collection-permission";
import type { FixedClaim } from "./fixed-claim";
import { ForcedDeletePermissions } from "./forced-delete-permissions";
import type { HookClaim } from "./hook-claim";
import type { HookName } from "../hooks/hook-name";
import { MediaForceDeletePermissions } from "./media-force-delete-permissions";
import { ParsedClaim } from "./parsed-claim";
import { RenamePermissions } from "./rename-permissions";
import { ScopeCopyPermissions } from "./scope-copy-permissions";
import { TransferPermissions } from "./transfer-permissions";

/** A held claim list, in either of the two forms callers keep them in. */
type HeldClaims = readonly string[] | readonly ParsedClaim[];

/**
 * The claim protocol, as one surface: the vocabulary (inherited), the grammar,
 * the presets, and the authority checks.
 *
 * Both the server and the admin UI evaluate claims through this and nothing
 * else — a second evaluator is a second enforcement point that can disagree
 * with the first. The behaviour lives in the classes it delegates to; this is
 * the front door.
 */
export class Claims extends ClaimVocabulary {
  static readonly TransferReadPermissions = TransferPermissions.Read;
  static readonly TransferWritePermissions = TransferPermissions.Write;
  static readonly TransferReplacePermissions = TransferPermissions.Replace;

  static readonly ScopeCopyReadPermissions = ScopeCopyPermissions.Read;
  static readonly ScopeCopyWritePermissions = ScopeCopyPermissions.Write;
  static readonly ScopeCopyReplacePermissions = ScopeCopyPermissions.Replace;

  /** What a `?force=true` delete exercises, at whatever reach it reaches. */
  static readonly ForcedDeletePermissions = ForcedDeletePermissions.All;

  /** What a media `?force=true` delete *additionally* exercises, at the
   *  scopes it is found to reach (D49) — see `RouteAuth.requireForcedMediaDelete`. */
  static readonly MediaForceDeletePermissions = MediaForceDeletePermissions.All;

  /** What renaming a project, environment or collection exercises, at the
   *  subject's own reach (D51). */
  static readonly RenamePermissions = RenamePermissions.All;

  static collection(
    project: string,
    env: string,
    name: string,
    permission: CollectionPermission,
  ): CollectionClaim {
    return ClaimGrammar.collection(project, env, name, permission);
  }

  static hook(project: string, env: string, name: string, hook: HookName): HookClaim {
    return ClaimGrammar.hook(project, env, name, hook);
  }

  static isCollectionName(name: string): boolean {
    return ClaimGrammar.isCollectionName(name);
  }

  /**
   * Whether a claim list permits **delivering** `hook` for one collection
   * (D34).
   *
   * Its own method rather than a `has` call at each site because the thing that
   * must not happen is a caller reaching for `entries:read` and believing it
   * asked this question: no collection permission satisfies a hook claim, and
   * `covers` refuses the mix, but naming it here is what stops the wrong
   * question being asked in the first place.
   */
  static canDeliver(
    claims: HeldClaims,
    project: string,
    env: string,
    collection: string,
    hook: HookName,
  ): boolean {
    return ClaimAuthorizer.has(claims, ClaimGrammar.hook(project, env, collection, hook));
  }

  static isScopeId(id: string): boolean {
    return ClaimGrammar.isScopeId(id);
  }

  static parse(claim: string): ParsedClaim {
    return ClaimGrammar.parse(claim);
  }

  static isValid(claim: string): claim is Claim {
    return ClaimGrammar.isValid(claim);
  }

  static isPreset(value: string): value is ClaimPreset {
    return ClaimGrammar.isPreset(value);
  }

  static normalize(value: unknown): Claim[] {
    return ClaimGrammar.normalize(value);
  }

  static presetCollectionPermissions(preset: ClaimPreset): readonly CollectionPermission[] {
    return ClaimPresets.collectionPermissions(preset);
  }

  static presetFixedClaims(preset: ClaimPreset): readonly FixedClaim[] {
    return ClaimPresets.fixedClaims(preset);
  }

  static fromPreset(preset: ClaimPreset, targets?: readonly string[]): Claim[] {
    return ClaimPresets.toClaims(preset, targets);
  }

  static has(claims: HeldClaims, required: Claim | ParsedClaim): boolean {
    return ClaimAuthorizer.has(claims, required);
  }

  static any(claims: HeldClaims, required: readonly (Claim | ParsedClaim)[]): boolean {
    return ClaimAuthorizer.any(claims, required);
  }

  static hasAnyCollectionPermission(
    claims: HeldClaims,
    permission: CollectionPermission,
    project?: string,
    env?: string,
  ): boolean {
    return ClaimAuthorizer.hasAnyCollectionPermission(claims, permission, project, env);
  }

  static canDelegate(own: HeldClaims, requested: readonly (Claim | ParsedClaim)[]): boolean {
    return ClaimAuthorizer.canDelegate(own, requested);
  }

  static hasInstanceWide(
    claims: HeldClaims,
    permissions: readonly CollectionPermission[],
  ): boolean {
    return ClaimAuthorizer.hasInstanceWide(claims, permissions);
  }

  static hasScopeWide(
    claims: HeldClaims,
    permissions: readonly CollectionPermission[],
    project: string,
    env: string,
  ): boolean {
    return ClaimAuthorizer.hasScopeWide(claims, permissions, project, env);
  }

  static accessLevel(claims: HeldClaims, project?: string, env?: string): AccessLevel {
    return ClaimSummary.accessLevel(claims, project, env);
  }

  static label(claims: readonly string[]): string {
    return ClaimSummary.label(claims);
  }
}
