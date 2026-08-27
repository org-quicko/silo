import { Claims } from "@silo/shared/claims";
import { KeyFormat } from "@silo/shared/key-format";
import { ValidationError } from "@silo/shared/validation-error";
import type { Entry } from "../domain/entry";
import { EntryUtils } from "../domain/entry-utils";
import { Scope } from "../domain/scope";
import type { KeyInfo } from "../keys/key-info";
import type { AuditActor } from "../audit/audit-actor";
import type { AuditService } from "./audit-service";
import type { AuthenticatedKey } from "../keys/authenticated-key";
import type { KeyMintOptions } from "../keys/key-mint-options";
import { KeyLineage, type IdentifiedKey } from "../keys/key-lineage";
import { KeyUtils } from "../keys/key-utils";
import type { KeyView } from "./support/key-view";
import type { ServiceContext } from "./support/service-context";

/**
 * API keys (D12).
 *
 * Keys are instance-wide, not per project/env, so nothing here takes a scope
 * from the caller — every method uses the reserved system scope (D18).
 */
export class KeyService {
  /** More keys than any instance is expected to hold; listing is unpaged. */
  private static readonly ListLimit = 500;

  private readonly context: ServiceContext;
  private readonly audit: AuditService;

  constructor(context: ServiceContext, audit: AuditService) {
    this.context = context;
    this.audit = audit;
  }

  /** The public shape of a key record — never the secret, which exists only
   *  in the response that mints it. */
  static toView(entry: Entry): KeyView {
    const info = entry.data as KeyInfo;
    return {
      id: entry.id,
      label: info.label,
      claims: Claims.normalize(info.claims),
      prefix: info.prefix,
      created_at:
        typeof entry.created_at === "string"
          ? entry.created_at
          : entry.created_at.toISOString(),
      // Disclosed, because a listing that showed a plugin's key as an ordinary
      // one would invite an operator to revoke it by hand and then wonder why
      // the plugin came back with a new one at the next start (D34).
      ...(info.owner ? { owner: info.owner } : {}),
      // Disclosed for the same reason `owner` is: revoking a key takes its
      // descendants with it (D38), and a list that hid the link would make that
      // look like data loss rather than the point.
      ...(info.parent_id ? { parent_id: info.parent_id } : {}),
    };
  }

  async create(
    label: string,
    claims: string[],
    options: KeyMintOptions = {}
  ): Promise<{ secret: string; entry: Entry }> {
    const keyLabel = typeof label === "string" && label.trim() ? label.trim() : "API key";
    const { secret, info } = KeyUtils.generateKey(keyLabel, claims, options);

    const now = EntryUtils.now();
    const entry: Entry = {
      id: EntryUtils.newID(),
      project: Scope.System.project,
      env: Scope.System.env,
      collection: KeyUtils.KeysCollection,
      rev: 1,
      seq: 0,
      created_at: now,
      updated_at: now,
      data: info,
    };

    await this.context.withWriteLock(() =>
      this.context.store.put(entry, { usages: [], search: null })
    );

    // Recorded here rather than at the route, so the offline `silo keys create`
    // lands in the trail too. A log that only sees the API would say a key
    // appeared from nowhere — which is exactly the question it exists to answer.
    await this.audit.record(
      "key.create",
      options.actor ?? { kind: "system" },
      entry.id,
      {
        label: info.label,
        prefix: info.prefix,
        claims: info.claims,
        ...(options.owner ? { owner: options.owner } : {}),
        ...(options.parentId ? { parent_id: options.parentId } : {}),
      }
    );
    return { secret, entry };
  }

  /** Records whose claims no longer parse are skipped rather than thrown on —
   *  one hand-edited record must not make the whole list a 500. */
  async list(): Promise<Entry[]> {
    const { items } = await this.context.store.list(Scope.System, KeyUtils.KeysCollection, {
      sort: [{ path: "$.created_at", desc: false }],
      limit: KeyService.ListLimit,
      offset: 0,
    });

    return items.filter((entry) => {
      try {
        Claims.normalize((entry.data as KeyInfo).claims);
        return true;
      } catch (error) {
        if (ValidationError.is(error)) return false;
        throw error;
      }
    });
  }

  /**
   * One key's record, by id. Throws `NotFoundError` if there is none.
   *
   * Exists so revocation can be bounded by what the *target* holds (D37) —
   * `keys:revoke` on its own said nothing about which keys, which made the
   * narrowest key that held it able to revoke root.
   *
   * Returned **as stored**, deliberately unlike `authenticate`: these claims
   * are being inspected, not exercised, and normalizing would throw on a
   * hand-edited record — turning the one operation that can clean such a record
   * up into a 500. `canDelegate` parses each claim itself and treats one it
   * cannot read as not-covered, so the check fails closed either way.
   */
  async find(id: string): Promise<KeyInfo> {
    const entry = await this.context.store.get(Scope.System, KeyUtils.KeysCollection, id);
    return entry.data as KeyInfo;
  }

  /**
   * Revoke an ordinary key **and everything it minted**.
   *
   * A **managed** key is refused (D34): it belongs to a plugin, silo holds its
   * secret, and it is re-minted at the next start — so revoking it by hand
   * looks like it worked and undoes itself. The refusal names the command that
   * actually withdraws the authority.
   *
   * The cascade is D37's fourth finding, and it is not optional (D38). A key
   * minted through `POST /api/keys` is bounded by its minter's authority at the
   * moment it is minted and by nothing afterwards, so leaving descendants behind
   * makes revocation a suggestion: anyone about to lose a key mints a spare
   * first. Making it a `?cascade=true` flag would put the correct behaviour
   * behind an argument nobody passes, which is the same as not having it.
   *
   * Returns every id removed, descendants first, so the caller can say what
   * happened — a 204 cannot, and the trail is where it is recorded.
   */
  async revoke(id: string, actor: AuditActor = { kind: "system" }): Promise<string[]> {
    const entry = await this.context.store.get(Scope.System, KeyUtils.KeysCollection, id);
    const info = entry.data as KeyInfo;
    if (KeyUtils.isManaged(info)) {
      throw new ValidationError(
        `key "${id}" belongs to plugin "${info.owner!.name}" and is managed by silo. ` +
          `Revoke the plugin's grant instead: silo plugin revoke ${info.owner!.name}`
      );
    }

    // Descendants first, so an interruption leaves the parent behind rather than
    // a set of orphans whose minter is gone and which nothing now points at.
    const doomed = await this.descendantsOf(id);
    for (const descendant of doomed) await this.discard(descendant.id);
    await this.discard(id);

    await this.audit.record("key.revoke", actor, id, {
      label: info.label,
      prefix: info.prefix,
      // Named individually, because the response is a 204 and this is the only
      // place that says a single revocation removed four credentials.
      cascaded: doomed.map((descendant) => descendant.id),
    });
    return [...doomed.map((descendant) => descendant.id), id];
  }

  /**
   * Every key minted by `id`, transitively.
   *
   * A managed key among the descendants would be a contradiction — silo mints
   * those itself and never from a request — so none is expected, and one found
   * is still removed: a plugin key whose grant no longer produces it is exactly
   * the orphan the ordinary revoke path refuses to clean up.
   */
  async descendantsOf(id: string): Promise<IdentifiedKey[]> {
    const all = (await this.list()).map((entry) => ({
      id: entry.id,
      info: entry.data as KeyInfo,
    }));
    return KeyLineage.descendantsOf(all, id);
  }

  /** Revoke without the managed-key guard. For `PluginGrantService`, which is
   *  the thing the guard exists to route callers towards. */
  async discard(id: string): Promise<void> {
    await this.context.withWriteLock(() =>
      this.context.store.delete(Scope.System, KeyUtils.KeysCollection, id)
    );
  }

  /** The presented key's record **and its id** — see `AuthenticatedKey` for why
   *  the id cannot simply live in the record. */
  async authenticate(secret: string): Promise<AuthenticatedKey> {
    if (!KeyFormat.looksLikeKey(secret)) {
      throw new ValidationError("unauthorized: invalid API key format");
    }

    const { items } = await this.context.store.list(Scope.System, KeyUtils.KeysCollection, {
      filter: { op: "eq", path: "$.data.hash", value: KeyUtils.hashKey(secret) },
      limit: 1,
      offset: 0,
    });
    if (items.length === 0) {
      throw new ValidationError("unauthorized: invalid API key");
    }

    const info = items[0].data as KeyInfo;
    return { ...info, id: items[0].id, claims: Claims.normalize(info.claims) };
  }

  /**
   * Mints the first root key on an instance that has none. Returns the empty
   * string when keys already exist, so a restart announces nothing.
   *
   * **Managed keys do not count** (D34). They are minted by silo for plugins
   * and nobody holds their secrets, so an instance whose only keys were managed
   * would have no way in at all — and would report itself as already
   * bootstrapped, which is the worst version of that.
   */
  async bootstrap(): Promise<string> {
    const existing = await this.list();
    if (existing.some((entry) => !KeyUtils.isManaged(entry.data as KeyInfo))) return "";
    const { secret } = await this.create("root", [Claims.Root]);
    return secret;
  }
}
