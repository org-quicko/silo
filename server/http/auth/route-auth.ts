import type { Context } from "hono";
import { Claims } from "@silo/shared/claims";
import type { Claim } from "@silo/shared/claim";
import type { CollectionPermission } from "@silo/shared/collection-permission";
import type { KeyInfo } from "../../core/keys/key-info";
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

  static requireKey(c: Context): KeyInfo {
    const key = c.get("keyInfo") as KeyInfo | undefined;
    if (!key) throw new UnauthorizedError("API key required for this operation");
    return key;
  }

  static requireClaim(c: Context, claim: Claim): KeyInfo {
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
  ): KeyInfo {
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

  static requirePublicOrClaim(
    c: Context,
    project: string,
    env: string,
    collection: string,
    permission: CollectionPermission,
    isPublic: boolean,
  ): KeyInfo | null {
    const key = c.get("keyInfo") as KeyInfo | undefined;
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
