import crypto from "crypto";
import { Claims } from "@silo/shared/claims";
import { ValidationError } from "@silo/shared/validation-error";
import type { Claim } from "@silo/shared/claim";
import type { PluginRoute } from "../../plugins/manifest/plugin-route";
import { SystemCollections } from "../domain/system-collections";
import type { PluginGrant } from "./plugin-grant";

/** The reserved collection, the digest, and the two set comparisons every
 *  grant decision is made of. */
export class PluginGrantUtils {
  static readonly PluginsCollection = SystemCollections.Plugins;

  /**
   * A stable digest of what a manifest **asks for**, not of the whole package.
   *
   * Only the fields an operator is approving go in: the requested claims, which
   * of them are required, the hooks, and the routes. A version bump that changes
   * none of those is not a new decision and must not re-prompt, and a package
   * that silently adds a hook — or silently promotes an optional claim to
   * required, so that a default grant would now approve it — is one even if its
   * version did not move.
   *
   * `routes` joined it in D41, and the case for it is the sharpest of the four.
   * `http:route` is one claim however many routes there are, so the claim list
   * cannot see the route surface change: a package could add `"auth": "public"`
   * to a route in a patch release and publish everything it was granted at an
   * unauthenticated URL, against an approval nobody was asked to reconsider.
   *
   * The `reason` strings are deliberately **out**. They are what an operator
   * reads while deciding, so including them is tempting, but a package fixing a
   * typo in one would then move every instance to `needs_review` for a decision
   * nobody changed — and re-prompting for nothing is how a review prompt stops
   * being read.
   */
  static digest(
    requested: readonly string[],
    required: readonly string[],
    hooks: readonly string[],
    routes: readonly string[] = []
  ): string {
    const canonical = JSON.stringify({
      claims: [...requested].sort(),
      required: [...required].sort(),
      hooks: [...hooks].sort(),
      // Defaulted and omitted when empty, so every record written before D41 for
      // a plugin with no routes keeps the digest it already has. A plugin *with*
      // routes moves to `needs_review` once, which is the decision it never had.
      ...(routes.length > 0 ? { routes: [...routes].sort() } : {}),
    });
    return crypto.createHash("sha256").update(canonical).digest("hex");
  }

  /**
   * One route, as the record stores it and the digest reads it (D41).
   *
   * A string rather than the object, for the same reason `hooks` is a list of
   * strings: the record is an ordinary queryable document, and a stored shape
   * that mirrors a manifest type is a second copy of that type to keep in step.
   * Readable rather than hashed, because an operator diffing a `needs_review`
   * record should be able to see *which* route changed.
   *
   * `auth` and the body contract are in it and nothing else is — they are the
   * two properties of a route an operator is deciding about. The method and path
   * are identity; `auth` decides whether a stranger can reach the plugin's grant;
   * the body decides how much the host allocates for them when they do.
   */
  static routeLine(route: PluginRoute): string {
    return (
      `${route.method} ${route.path} auth=${route.auth} ` +
      `body=${route.body.kind}:${route.body.max_bytes}`
    );
  }

  static routeLines(routes: readonly PluginRoute[]): string[] {
    return routes.map((route) => PluginGrantUtils.routeLine(route));
  }

  /**
   * A record's approved route surface (D41).
   *
   * Absent in a record written before D41, and the honest reading of one is the
   * empty list: whatever routes the package had, they were not part of what was
   * approved. `requiredOf` reads a legacy field the other way round — as
   * *everything* — and the difference is not inconsistency: there, the field
   * being absent meant the distinction did not exist yet and every claim was
   * required; here, it meant the surface was never reviewed.
   */
  static routesOf(grant: Pick<PluginGrant, "routes">): string[] {
    return grant.routes ?? [];
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

  /**
   * Which of a record's requested claims are required (D36).
   *
   * A record written before the split carries no `required`, and the honest
   * reading of one is that every claim in it was required — there was no other
   * kind. Defaulting to the empty set instead would make a default grant on an
   * un-reconciled legacy record approve nothing and report success.
   */
  static requiredOf(grant: Pick<PluginGrant, "requested" | "required">): string[] {
    return grant.required ?? grant.requested;
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
