import crypto from "crypto";
import { Claims } from "@silo/shared/claims";
import { ValidationError } from "@silo/shared/validation-error";
import type { Claim } from "@silo/shared/claim";
import type { PluginGrant } from "./plugin-grant";

/** The reserved collection, the digest, and the two set comparisons every
 *  grant decision is made of. */
export class PluginGrantUtils {
  static readonly PluginsCollection = "_plugins";

  /**
   * A stable digest of what a manifest **asks for**, not of the whole package.
   *
   * Only the fields an operator is approving go in: the requested claims and
   * the hooks. A version bump that changes neither is not a new decision and
   * must not re-prompt, and a package that silently adds a hook is one even if
   * its version did not move.
   */
  static digest(requested: readonly string[], hooks: readonly string[]): string {
    const canonical = JSON.stringify({
      claims: [...requested].sort(),
      hooks: [...hooks].sort(),
    });
    return crypto.createHash("sha256").update(canonical).digest("hex");
  }

  /**
   * The claims in `granted` that `requested` does not cover.
   *
   * The check `PluginLoader.assertGranted` never had. It enforced
   * `requested ⊆ granted` and not the converse, so an operator could grant past
   * the manifest — defensible while a human typed TOML, wrong the moment a
   * surface displays "this plugin requested X" beside a grant that exceeds it.
   */
  static ungranted(requested: readonly string[], granted: readonly string[]): string[] {
    return granted.filter((claim) => !Claims.has(requested, claim as Claim));
  }

  /** The claims a manifest asks for that the operator has not allowed. Not an
   *  error: a plugin may run on less than it asked for, and `optional` requests
   *  exist for exactly that. */
  static missing(requested: readonly string[], granted: readonly string[]): string[] {
    return requested.filter((claim) => !Claims.has(granted, claim as Claim));
  }

  /**
   * Refuse a grant that would let a plugin widen its own grant (D34).
   *
   * Checked when approving rather than when calling, so it is visible to
   * whoever is deciding instead of surfacing later as a 403 inside a hook.
   */
  static assertGrantable(name: string, claims: readonly string[]): void {
    if (claims.includes(Claims.Root)) {
      throw new ValidationError(
        `plugin "${name}" cannot be granted root: a plugin runs code, so root would ` +
          `include the authority to widen its own grant. Name the claims it needs.`
      );
    }
    const forbidden = claims.filter((claim) =>
      (Claims.PluginForbiddenClaims as readonly string[]).includes(claim)
    );
    if (forbidden.length > 0) {
      throw new ValidationError(
        `plugin "${name}" cannot be granted ${forbidden.join(", ")}: a plugin holding ` +
          `these could step outside its own grant — by widening the record, or by ` +
          `minting or planting a credential the record does not bound.`
      );
    }
  }

  /** The state a record should be in given what it holds and what the package
   *  now asks for. One place, because four call sites deciding this
   *  independently is how two of them end up disagreeing. */
  static stateFor(grant: PluginGrant, currentDigest: string): PluginGrant["state"] {
    if (grant.state === "revoked" || grant.state === "pending") return grant.state;
    return grant.manifest_digest === currentDigest ? "granted" : "needs_review";
  }

  /** Whether a plugin in this state may be dispatched to and may call `ctx`. */
  static isActive(state: PluginGrant["state"]): boolean {
    return state === "granted" || state === "needs_review";
  }

  /**
   * The config a plugin actually runs with (D39).
   *
   * The stored override wins whole when there is one, and `silo.toml`'s block
   * applies otherwise — an override *replaces* rather than merges, so the
   * answer to "what is this plugin configured with" is one document somebody
   * wrote rather than a computation over two. One place, because the loader,
   * the supervisor and the management view all have to agree about it.
   */
  static configFor(
    grant: Pick<PluginGrant, "config"> | null,
    declared: Record<string, unknown>
  ): Record<string, unknown> {
    return grant?.config ?? declared;
  }
}
