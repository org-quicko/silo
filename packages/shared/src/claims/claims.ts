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
import { ParsedClaim } from "./parsed-claim";
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

  static collection(
    project: string,
    env: string,
    name: string,
    permission: CollectionPermission,
  ): CollectionClaim {
    return ClaimGrammar.collection(project, env, name, permission);
  }

  static isCollectionName(name: string): boolean {
    return ClaimGrammar.isCollectionName(name);
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
