import { ValidationError } from "../errors/validation-error";
import type { Claim } from "./claim";
import { ClaimGrammar } from "./claim-grammar";
import type { ClaimPreset } from "./claim-preset";
import { ClaimVocabulary } from "./claim-vocabulary";
import type { CollectionPermission } from "./collection-permission";
import type { FixedClaim } from "./fixed-claim";

/** A preset target, spelled `project/env/collection`, `project/env`, a bare
 *  collection name, or `*`. */
interface ClaimTarget {
  project: string;
  env: string;
  collection: string;
}

/** The four named bundles a key can be minted with, and what each grants. */
export class ClaimPresets {
  /**
   * What each non-root preset grants **per target**, widest last.
   *
   * `manage` exists because collection lifecycle — creating a collection,
   * editing its schema, flipping its public-read access, deleting it — was
   * otherwise reachable only one collection at a time by naming each claim
   * individually. It is the rung between `write` (an integration that moves
   * entries through collections someone else defined) and `root` (everything,
   * everywhere, including minting keys and moving the whole instance).
   */
  private static readonly Permissions: Record<
    Exclude<ClaimPreset, "root">,
    readonly CollectionPermission[]
  > = {
    read: [ClaimVocabulary.CollectionSchemaRead, ClaimVocabulary.CollectionEntriesRead],
    write: [
      ClaimVocabulary.CollectionSchemaRead,
      ClaimVocabulary.CollectionEntriesRead,
      ClaimVocabulary.CollectionEntriesCreate,
      ClaimVocabulary.CollectionEntriesUpdate,
      ClaimVocabulary.CollectionEntriesDelete,
    ],
    manage: [
      ClaimVocabulary.CollectionSchemaRead,
      ClaimVocabulary.CollectionEntriesRead,
      ClaimVocabulary.CollectionEntriesCreate,
      ClaimVocabulary.CollectionEntriesUpdate,
      ClaimVocabulary.CollectionEntriesDelete,
      ClaimVocabulary.CollectionCreate,
      ClaimVocabulary.CollectionSchemaUpdate,
      ClaimVocabulary.CollectionAccessUpdate,
      ClaimVocabulary.CollectionDelete,
    ],
  };

  /** The media claims each non-root preset carries alongside its collection
   *  permissions. */
  private static readonly Media: Record<
    Exclude<ClaimPreset, "root">,
    readonly FixedClaim[]
  > = {
    read: [ClaimVocabulary.MediaRead],
    write: [
      ClaimVocabulary.MediaRead,
      ClaimVocabulary.MediaCreate,
      ClaimVocabulary.MediaDelete,
    ],
    manage: [
      ClaimVocabulary.MediaRead,
      ClaimVocabulary.MediaCreate,
      ClaimVocabulary.MediaDelete,
    ],
  };

  /** The collection permissions `preset` grants on each of its targets. */
  static collectionPermissions(preset: ClaimPreset): readonly CollectionPermission[] {
    if (preset === "root") {
      return Object.keys(ClaimVocabulary.CollectionPermissions) as CollectionPermission[];
    }
    return ClaimPresets.Permissions[preset];
  }

  /** The unscoped claims `preset` grants regardless of its targets. */
  static fixedClaims(preset: ClaimPreset): readonly FixedClaim[] {
    if (preset === "root") return Object.keys(ClaimVocabulary.FixedClaims) as FixedClaim[];
    return ClaimPresets.Media[preset];
  }

  /** Expands a preset into the claim list a key is minted with. */
  static toClaims(preset: ClaimPreset, targets: readonly string[] = [ClaimVocabulary.Root]): Claim[] {
    if (preset === "root") return [ClaimVocabulary.Root];

    // Exhaustiveness is enforced by the `Record<Exclude<ClaimPreset, "root">>`
    // type on both tables — a new preset that forgets to say what it grants is a
    // compile error there. This only catches a caller that bypassed the types.
    const permissions = ClaimPresets.Permissions[preset];
    const media = ClaimPresets.Media[preset];
    if (permissions === undefined || media === undefined) {
      throw new ValidationError(`unhandled preset "${String(preset)}"`);
    }

    const claims: Claim[] = [...media];
    for (const target of targets) {
      const { project, env, collection } = ClaimPresets.parseTarget(target);
      for (const permission of permissions) {
        claims.push(ClaimGrammar.collection(project, env, collection, permission));
      }
    }
    return ClaimGrammar.normalize(claims);
  }

  private static parseTarget(target: string): ClaimTarget {
    if (target === ClaimVocabulary.Root || target === "*/*/*") {
      return { project: "*", env: "*", collection: "*" };
    }
    if (!target.includes("/")) {
      return { project: "*", env: "*", collection: target };
    }

    const parts = target.split("/");
    if (parts.length === 3) {
      return { project: parts[0], env: parts[1], collection: parts[2] };
    }
    if (parts.length === 2) {
      return { project: parts[0], env: parts[1], collection: "*" };
    }
    throw new ValidationError(
      `invalid target "${target}": want project/env/collection, project/env, or *`,
    );
  }
}
