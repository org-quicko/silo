import type { Context } from "hono";
import { Claims } from "@silo/shared/claims";
import type { Claim } from "@silo/shared/claim";
import { SiloService } from "../../core/services/silo-service";
import { KeyService } from "../../core/services/key-service";
import type { AuditActor } from "../../core/audit/audit-actor";
import { AuditUtils } from "../../core/audit/audit-utils";
import type { AuthenticatedKey } from "../../core/keys/authenticated-key";
import { ForbiddenError } from "../../core/errors/forbidden-error";
import { ValidationError } from "@silo/shared/validation-error";
import { RouteAuth } from "../auth/route-auth";

export class KeysRoutes {
  static register(app: any, service: SiloService) {
    app.get("/api/keys", async (c: Context) => {
      RouteAuth.requireClaim(c, Claims.KeysRead);
      const keys = await service.keys.list();
      const views = keys.map(KeyService.toView);
      return c.json({ items: views });
    });

    app.post("/api/keys", async (c: Context) => {
      const caller = RouteAuth.requireClaim(c, Claims.KeysCreate);
      const body = await c.req.json();
      if (!body || typeof body !== "object") {
        throw new ValidationError("invalid body: want {label, claims}");
      }
      const claims = Claims.normalize(body.claims);
      if (!Claims.canDelegate(caller.claims, claims)) {
        throw new ForbiddenError("cannot create a key with claims the current key does not hold");
      }
      // `parentId` is what makes revocation transitive (D38): a key minted here
      // is bounded by its minter's authority at this moment and by nothing
      // afterwards, so without the link it would outlive the key that vouched
      // for it. Omitted when the caller has no id — the `--no-auth` principal.
      const { secret, entry } = await service.keys.create(body.label, claims, {
        ...(caller.id ? { parentId: caller.id } : {}),
        actor: KeysRoutes.actor(caller),
      });
      return c.json(
        {
          key: secret,
          ...KeyService.toView(entry),
        },
        201
      );
    });

    /**
     * Change what an existing key is called and what it may do (D63).
     *
     * Gated on `keys:create` rather than a claim of its own, because an edit
     * confers nothing a mint does not: whatever claim list it writes, the caller
     * could have minted a key carrying it. What makes an edit *different* from a
     * mint is the other end — it acts on a secret someone is already holding —
     * and that is bounded here by **two** `canDelegate` checks rather than by a
     * third claim word:
     *
     * - against the target's **current** claims, which is revoke's bound (D37).
     *   Without it the narrowest key holding `keys:create` could rewrite the
     *   root key's claims down to its own and lock the instance out, which is
     *   D37's finding with the verb changed.
     * - against the **requested** claims, which is minting's bound. Without it
     *   an edit is escalation with extra steps.
     *
     * A key editing itself passes both, since a claim list always covers
     * itself — so narrowing your own key works and widening it does not.
     */
    app.patch("/api/keys/:id", async (c: Context) => {
      const caller = RouteAuth.requireClaim(c, Claims.KeysCreate);
      const id = c.req.param("id") || "";
      const body = await c.req.json();
      if (!body || typeof body !== "object") {
        throw new ValidationError("invalid body: want {label} and/or {claims}");
      }

      const target = await service.keys.find(id);
      // Unnormalized, like the revoke path: a hand-edited record must stay
      // editable, and `canDelegate` treats a claim it cannot parse as
      // not-covered, so the check fails closed either way.
      if (!Claims.canDelegate(caller.claims, target.claims as Claim[])) {
        throw new ForbiddenError(
          `cannot edit a key holding claims the current key does not: ` +
            `editing is bounded by the same authority revoking is`
        );
      }

      const claims = body.claims === undefined ? undefined : Claims.normalize(body.claims);
      if (claims && !Claims.canDelegate(caller.claims, claims)) {
        throw new ForbiddenError("cannot give a key claims the current key does not hold");
      }

      const entry = await service.keys.update(id, {
        ...(body.label === undefined ? {} : { label: body.label }),
        ...(claims === undefined ? {} : { claims }),
        actor: KeysRoutes.actor(caller),
      });
      return c.json(KeyService.toView(entry));
    });

    /**
     * Revoking is bounded by the same rule minting is (D37).
     *
     * `keys:revoke` names an operation, not a target, so on its own it let the
     * narrowest key holding it destroy the root key and lock the instance out —
     * measured, not theorised. The bound is `canDelegate`, deliberately the
     * same predicate `POST /api/keys` uses: **if you could not mint a key this
     * powerful, you may not destroy one.** A key still revokes itself, since a
     * claim list always covers itself.
     */
    app.delete("/api/keys/:id", async (c: Context) => {
      const caller = RouteAuth.requireClaim(c, Claims.KeysRevoke);
      const id = c.req.param("id") || "";
      const target = await service.keys.find(id);
      // Passed unnormalized on purpose — see `KeyService.find`. Root short-
      // circuits, so a corrupt record is still removable by the key that can
      // remove anything.
      if (!Claims.canDelegate(caller.claims, target.claims as Claim[])) {
        throw new ForbiddenError(
          `cannot revoke a key holding claims the current key does not: ` +
            `revoking is bounded by the same authority minting is`
        );
      }
      // Takes the target's descendants with it (D38). Still a 204: the list of
      // what went is in the trail, which is the surface built to answer
      // "what happened to those other keys".
      await service.keys.revoke(id, KeysRoutes.actor(caller));
      return c.body(null, 204);
    });
  }

  /** The audit actor for a request. `--no-auth` has no key to name, so it is
   *  recorded as `system` rather than as a key with an empty id. */
  private static actor(caller: AuthenticatedKey): AuditActor {
    return caller.id ? AuditUtils.key(caller.id, caller) : { kind: "system" };
  }
}
