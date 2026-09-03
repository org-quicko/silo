import type { Context } from "hono";
import { Claims } from "@silo/shared/claims";
import type { Claim } from "@silo/shared/claim";
import type { CollectionPermission } from "@silo/shared/collection-permission";
import type { AuditActor } from "../../core/audit/audit-actor";
import { AuditUtils } from "../../core/audit/audit-utils";
import type { AuthenticatedKey } from "../../core/keys/authenticated-key";
import type { WriteContext } from "../../core/hooks";
import { WriteContexts } from "../../core/hooks";
import { Scope } from "../../core/domain/scope";
import { ValidationError } from "@silo/shared/validation-error";
import { ForbiddenError } from "../../core/errors/forbidden-error";
import { UnauthorizedError } from "../../core/errors/unauthorized-error";
import type { MediaService } from "../../core/services/media/media-service";

export class RouteAuth {
  static getScope(c: Context): Scope {
    const project = c.req.param("project") || "";
    const env = c.req.param("env") || "";
    return Scope.of(project, env);
  }

  /**
   * The audit actor for a request. `--no-auth` has no key to name, so it is
   * recorded as `system` rather than as a key with an empty id.
   *
   * Here rather than repeated per route group: five of them had the same line,
   * and a sixth wanted it.
   */
  static getActor(c: Context): AuditActor {
    const caller = c.get("keyInfo") as AuthenticatedKey | undefined;
    if (!caller) return { kind: "system" };
    return caller.id ? AuditUtils.key(caller.id, caller) : { kind: "system" };
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
  /**
   * A rename is a create at the new name and a delete at the old, so it asks
   * for both, at the subject's own reach (D51): `{project}/*​/*` for a project,
   * `{project}/{env}/*` for an environment, the one collection for a
   * collection. Same shape as `requireForcedDelete`, different claim set.
   *
   * What the rename **cascades** into is a separate ask, made only when there
   * is something to rewrite — see `ScopeRenameCascade`.
   */
  static requireRename(
    c: Context,
    subject: string,
    project: string,
    env: string,
    collection: string,
  ): AuthenticatedKey {
    const key = RouteAuth.requireKey(c);
    for (const permission of Claims.RenamePermissions) {
      const claim = Claims.collection(project, env, collection, permission);
      if (!Claims.has(key.claims, claim)) {
        throw new ForbiddenError(
          `renaming ${subject} retires the old name and introduces a new one; this key is missing claim "${claim}"`,
        );
      }
    }
    return key;
  }

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

  /**
   * The extra authority a media `?force=true` delete needs (D49) — the sibling
   * `requireForcedDelete` doesn't have, because a media force's reach is
   * **data-derived** rather than the route's own scope parameters. It must
   * enumerate who currently refers to `mediaIds` before it can know which
   * scopes to check, which is a store query — the one reason this is `async`
   * and its sibling is not.
   *
   * Checked against `media.forceReach`, the TRUE referrer set, never a
   * claim-filtered one: filtering first would let a key force-delete
   * *because* it cannot see the referrers, and a key that cannot read a scope
   * necessarily lacks `entries:update` there, so refusing it is the correct
   * and self-consistent outcome (§8.1).
   *
   * When the reach is too wide to enumerate exactly (over the 2000-row cap
   * `MediaUsageScopes` pages up to), only a key holding `*` may proceed —
   * silo cannot enumerate everything the operation would break, so only a key
   * that can do anything may do this one.
   *
   * The refusal names only the scopes the key may already read and counts the
   * rest, the same split the `409` body takes: checking against the true reach
   * must not become the one place that discloses it (§8.1).
   */
  static async requireForcedMediaDelete(
    c: Context,
    operation: string,
    media: MediaService,
    mediaIds: readonly string[],
  ): Promise<void> {
    const key = RouteAuth.requireKey(c);
    const reach = await media.forceReach(mediaIds);

    if (reach.capped) {
      if (!Claims.has(key.claims, Claims.Root)) {
        throw new ForbiddenError(
          `${operation} with force references too many entries to enumerate exactly; only a key holding "*" may force it`,
        );
      }
      return;
    }

    const missing = reach.scopes.filter((scope) =>
      Claims.MediaForceDeletePermissions.some(
        (permission) =>
          !Claims.has(
            key.claims,
            Claims.collection(scope.project, scope.env, scope.collection, permission),
          ),
      ),
    );
    if (missing.length === 0) return;

    // Every scope, not the first one found: throwing inside the loop would
    // have made the refusal name whichever hidden scope happened to sort
    // first.
    const readable = missing.filter((scope) =>
      RouteAuth.canReadEntries(c, scope.project, scope.env, scope.collection),
    );
    const hidden = missing.length - readable.length;

    const where: string[] = [];
    if (readable.length > 0) {
      where.push(readable.map((scope) => `${scope.project}/${scope.env}/${scope.collection}`).join(", "));
    }
    if (hidden > 0) {
      where.push(`${hidden} scope${hidden === 1 ? "" : "s"} this key cannot read`);
    }
    const needed = Claims.MediaForceDeletePermissions.join('", "');

    throw new ForbiddenError(
      `${operation} with force changes what the entries referring to it resolve to, so it needs "${needed}" at every referring scope; this key is missing that at ${where.join(" and ")}`,
    );
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
    const revision = RouteAuth.findExpectedRev(c);
    if (revision === undefined) {
      throw new ValidationError('missing expected rev: send If-Match: "<rev>" or ?rev=<rev>');
    }
    return revision;
  }

  /**
   * The same revision, when the caller may legitimately not have one.
   *
   * One caller: `DELETE /api/plugins/:name`, which acts on up to four things —
   * a `silo.toml` entry, a record, a worker and a directory — of which only the
   * record has a revision. A package that never got one (a provider-only
   * install, §13.7) would otherwise be demanded an `If-Match` that does not
   * exist, and be impossible to remove through the API that installed it. The
   * fence is applied where the record is known to be there, which is the only
   * place that can tell the two cases apart.
   *
   * A malformed value is still refused: absent and wrong are different answers.
   */
  static findExpectedRev(c: Context): number | undefined {
    let value = (c.req.header("If-Match") || "").trim().replace(/"/g, "");
    if (!value) value = c.req.query("rev") || "";
    if (!value) return undefined;

    const revision = parseInt(value, 10);
    if (isNaN(revision) || revision < 1) {
      throw new ValidationError(`invalid rev "${value}"`);
    }
    return revision;
  }
}
