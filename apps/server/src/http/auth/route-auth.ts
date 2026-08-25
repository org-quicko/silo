import type { Context } from "hono";
import { Claims } from "@silo/shared/claims";
import type { Claim } from "@silo/shared/claim";
import type { CollectionPermission } from "@silo/shared/collection-permission";
import type { AuthenticatedKey } from "../../core/keys/authenticated-key";
import type { WriteContext } from "../../core/hooks";
import { WriteContexts } from "../../core/hooks";
import { Scope } from "../../core/domain/scope";
import { ValidationError } from "@silo/shared/validation-error";
import { ForbiddenError } from "../../core/errors/forbidden-error";
import { UnauthorizedError } from "../../core/errors/unauthorized-error";

export class RouteAuth {
  static getScope(c: Context): Scope {
    const project = c.req.param("project") || "";
    const env = c.req.param("env") || "";
    return Scope.of(project, env);
  }

  static requireKey(c: Context): AuthenticatedKey {
    const key = c.get("keyInfo") as AuthenticatedKey | undefined;
    if (!key) throw new UnauthorizedError("API key required for this operation");
    return key;
  }

  static requireClaim(c: Context, claim: Claim): AuthenticatedKey {
    const key = RouteAuth.requireKey(c);
    if (!Claims.has(key.claims, claim)) {
      throw new ForbiddenError(`this key is missing claim "${claim}"`);
    }
    return key;
  }

  static requireCollectionClaim(
    c: Context,
    project: string,
    env: string,
    collection: string,
    permission: CollectionPermission,
  ): AuthenticatedKey {
    return RouteAuth.requireClaim(
      c,
      Claims.collection(project, env, collection, permission),
    );
  }

  /**
   * Export, import and copy act on the **whole instance** — one archive
   * carries every project and every env, and scoping them is later work. The
   * `transfer:*` claims are fixed claims, so they carry no scope of their own;
   * on their own they would hand a key scoped to one project a way straight
   * out of it, reading or overwriting every other tenant's content. Holding
   * them is therefore necessary but not sufficient: the caller must also hold
   * the collection permissions the operation exercises at instance scope
   * (`*` / `*` / `*`), which is precisely the authority the archive confers.
   * The permission lists live on `Claims` so the UI gates its transfer
   * affordances on the same rule this enforces.
   */
  static requireInstanceWide(
    c: Context,
    operation: string,
    permissions: readonly CollectionPermission[],
  ): void {
    const key = RouteAuth.requireKey(c);
    for (const permission of permissions) {
      const claim = Claims.collection("*", "*", "*", permission);
      if (!Claims.has(key.claims, claim)) {
        throw new ForbiddenError(
          `${operation} covers every project and environment, so it needs instance-wide authority; this key is missing claim "${claim}"`,
        );
      }
    }
  }

  /**
   * The scoped counterpart of `requireInstanceWide`: every one of
   * `permissions` held for all collections of one (project, env).
   *
   * A scope-to-scope copy needs this twice — the read half at the source and
   * the write half at the destination — and needs no fixed `transfer:*` claim
   * at all, because it reaches no scope the caller could not already read or
   * write one entry at a time (D22).
   */
  static requireScopeWide(
    c: Context,
    operation: string,
    project: string,
    env: string,
    permissions: readonly CollectionPermission[],
  ): void {
    const key = RouteAuth.requireKey(c);
    for (const permission of permissions) {
      const claim = Claims.collection(project, env, "*", permission);
      if (!Claims.has(key.claims, claim)) {
        throw new ForbiddenError(
          `${operation} covers every collection in ${project}/${env}; this key is missing claim "${claim}"`,
        );
      }
    }
  }

  /**
   * The extra authority `?force=true` needs on a delete (D37).
   *
   * `force` is not a modifier, it is a second operation. Without it these routes
   * refuse while any content exists, so `collection:delete` alone is an honest
   * ask: the caller is removing a definition that holds nothing. With it the
   * same request erases every entry underneath — a bulk `entries:delete`
   * wearing a collection-lifecycle claim, dispatching no hooks and asking for
   * no revision.
   *
   * `collection` is `*` for the project and environment routes, whose `force`
   * reaches every collection in the scope rather than one. The permission pair
   * lives on `Claims` for the reason `requireInstanceWide` gives: the admin UI
   * gates its delete buttons on the same list this enforces, so an affordance
   * and a refusal cannot disagree.
   */
  static requireForcedDelete(
    c: Context,
    operation: string,
    project: string,
    env: string,
    collection: string,
  ): void {
    const key = RouteAuth.requireKey(c);
    for (const permission of Claims.ForcedDeletePermissions) {
      const claim = Claims.collection(project, env, collection, permission);
      if (!Claims.has(key.claims, claim)) {
        throw new ForbiddenError(
          `${operation} with force erases the entries as well as the definition; this key is missing claim "${claim}"`,
        );
      }
    }
  }

  static requirePublicOrClaim(
    c: Context,
    project: string,
    env: string,
    collection: string,
    permission: CollectionPermission,
    isPublic: boolean,
  ): AuthenticatedKey | null {
    const key = c.get("keyInfo") as AuthenticatedKey | undefined;
    if (!key) {
      if (isPublic) return null;
      throw new UnauthorizedError("API key required for this operation");
    }
    const claim = Claims.collection(project, env, collection, permission);
    if (!Claims.has(key.claims, claim)) {
      throw new ForbiddenError(`this key is missing claim "${claim}"`);
    }
    return key;
  }

  /**
   * Whether this request may read entries of one collection — a predicate,
   * not an assertion, because the caller is deciding what to *show* rather
   * than whether to proceed.
   *
   * Media is instance-global but the entries referencing it are scoped, so a
   * refused media delete has to report how widely a file is used without
   * naming scopes the key cannot see (§8.1). Anonymous callers get nothing
   * enumerated: a public collection is readable entry by entry, but a media
   * usage listing is a cross-scope index of where things live, which is more
   * than any one public read discloses.
   */
  static canReadEntries(c: Context, project: string, env: string, collection: string): boolean {
    const key = c.get("keyInfo") as AuthenticatedKey | undefined;
    if (!key) return false;
    return Claims.has(
      key.claims,
      Claims.collection(project, env, collection, Claims.CollectionEntriesRead),
    );
  }

  /**
   * Who caused this write, for the hooks it will dispatch (D33, D35).
   *
   * An ordinary request has no opinion and gets `WriteContexts.Api`. A request
   * a plugin dispatched carries the causal chain of the hook it came out of, so
   * `HookBus` can refuse to deliver the resulting event back to any plugin
   * already on that stack — which is what makes a cycle unrepresentable rather
   * than merely bounded.
   *
   * One helper rather than a read at each write route, because the slot is an
   * implementation detail of the dispatch and a route that reached for it
   * directly would be a second place to get it wrong. Before phase 3 the chain
   * never crossed an HTTP boundary at all; `PluginContext` held it and called
   * `EntryService` directly, and that is exactly the path D35 replaced.
   */
  static getWriteContext(c: Context): WriteContext {
    return (c.get("writeContext") as WriteContext | undefined) ?? WriteContexts.Api;
  }

  static getExpectedRev(c: Context): number {
    let value = (c.req.header("If-Match") || "").trim().replace(/"/g, "");
    if (!value) value = c.req.query("rev") || "";
    if (!value) {
      throw new ValidationError('missing expected rev: send If-Match: "<rev>" or ?rev=<rev>');
    }
    const revision = parseInt(value, 10);
    if (isNaN(revision) || revision < 1) {
      throw new ValidationError(`invalid rev "${value}"`);
    }
    return revision;
  }
}
