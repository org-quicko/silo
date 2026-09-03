/** Which of a claim's three scope segments a rename moves. */
export type RenameSubject = "project" | "environment" | "collection";

/**
 * One rename, named the way a claim addresses it: the subject's old and new
 * name, plus the *current* names of its ancestors, which is what decides
 * whether a claim naming `from` is naming this thing or a different one.
 */
export interface ScopeRename {
  subject: RenameSubject;
  from: string;
  to: string;
  /** The renamed project's own name for a project rename, otherwise its
   *  parent's. */
  project: string;
  /** Required for a collection rename; the renamed environment's own name for
   *  an environment rename. */
  env?: string;
}

export interface ClaimRewriteOutcome {
  claim: string;
  /** A literal segment named this thing and was changed. */
  rewritten: boolean;
  /**
   * The claim's reach changes even though nothing was rewritten, because it
   * names the subject through a **wildcard ancestor** and so is not about this
   * one thing. Disclosed to the operator rather than silently mechanised.
   */
  patternAffected: boolean;
}

/**
 * Rewriting claim strings when a project, environment or collection is renamed
 * (D51). Pure, so the rules are testable without a store.
 *
 * The whole cascade rests on one distinction:
 *
 * - **A literal segment is a reference to an entity.** It is rewritten.
 * - **A wildcard segment is a pattern over names.** It is never rewritten.
 *
 * `collections:*​/dev/*` means "any project's `dev`", and it already matches
 * scopes that do not exist yet — that is what independent per-segment wildcards
 * are *for* (D19). So renaming `acme/dev` cannot rewrite it to `*​/prod/*`,
 * which would change authority in every project on the instance; and it cannot
 * leave it alone silently either, because the key does lose its reach into that
 * environment and will reach a future new `acme/dev`. Both readings are correct
 * and neither is a rewrite, so the claim is reported as `patternAffected` and
 * the operator is told.
 *
 * The test is therefore not "does a segment equal `from`" but "does this claim
 * name *this* entity": the subject's segment must be the literal `from`, **and**
 * every ancestor segment must literally name the subject's actual ancestor. An
 * ancestor wildcard makes the claim broader than the rename; an ancestor
 * naming something else makes it about a different entity entirely.
 */
export class ClaimRewrite {
  private static readonly Wildcard = "*";
  private static readonly ScopedPrefixes = new Set(["collections", "hooks"]);

  static rewrite(claim: string, rename: ScopeRename): ClaimRewriteOutcome {
    const parts = ClaimRewrite.split(claim);
    if (parts === null) {
      return { claim, rewritten: false, patternAffected: false };
    }

    const index = ClaimRewrite.indexOf(rename.subject);
    const segments = parts.segments;
    if (segments[index] !== rename.from) {
      return { claim, rewritten: false, patternAffected: false };
    }

    const ancestors = ClaimRewrite.ancestorsOf(rename);
    for (let position = 0; position < index; position++) {
      const segment = segments[position];
      if (segment === ClaimRewrite.Wildcard) {
        // Broader than the rename: it covers this name in scopes the rename
        // does not touch, so substituting here would move authority elsewhere.
        return { claim, rewritten: false, patternAffected: true };
      }
      if (segment !== ancestors[position]) {
        // A different entity that happens to share the subject's name.
        return { claim, rewritten: false, patternAffected: false };
      }
    }

    const moved = [...segments];
    moved[index] = rename.to;
    return {
      claim: `${parts.prefix}:${moved.join("/")}${parts.suffix}`,
      rewritten: true,
      patternAffected: false,
    };
  }

  /** Every claim in `claims`, partitioned by what the rename does to it. */
  static plan(
    claims: readonly string[],
    rename: ScopeRename
  ): { claims: string[]; rewritten: string[]; patternAffected: string[] } {
    const next: string[] = [];
    const rewritten: string[] = [];
    const patternAffected: string[] = [];

    for (const claim of claims) {
      const outcome = ClaimRewrite.rewrite(claim, rename);
      next.push(outcome.claim);
      if (outcome.rewritten) rewritten.push(claim);
      if (outcome.patternAffected) patternAffected.push(claim);
    }
    return { claims: next, rewritten, patternAffected };
  }

  private static indexOf(subject: RenameSubject): number {
    if (subject === "project") return 0;
    return subject === "environment" ? 1 : 2;
  }

  /** The subject's ancestors, by position, as the rename names them. */
  private static ancestorsOf(rename: ScopeRename): (string | undefined)[] {
    return [rename.project, rename.env];
  }

  /**
   * `collections:<p>/<e>/<c>:<permission>` split into its three parts, or null
   * when the claim carries no scope at all (`*`, a fixed claim).
   *
   * The suffix is taken from the **second** colon rather than by splitting on
   * every colon, because a permission contains one of its own
   * (`entries:read`).
   */
  private static split(
    claim: string
  ): { prefix: string; segments: string[]; suffix: string } | null {
    const first = claim.indexOf(":");
    if (first < 0) return null;

    const prefix = claim.slice(0, first);
    if (!ClaimRewrite.ScopedPrefixes.has(prefix)) return null;

    const second = claim.indexOf(":", first + 1);
    if (second < 0) return null;

    const segments = claim.slice(first + 1, second).split("/");
    if (segments.length !== 3) return null;

    return { prefix, segments, suffix: claim.slice(second) };
  }
}
