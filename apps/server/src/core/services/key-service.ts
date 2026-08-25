import { Claims } from "@silo/shared/claims";
import { KeyFormat } from "@silo/shared/key-format";
import { ValidationError } from "@silo/shared/validation-error";
import type { Entry } from "../domain/entry";
import { EntryUtils } from "../domain/entry-utils";
import { Scope } from "../domain/scope";
import type { KeyInfo } from "../keys/key-info";
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

  constructor(context: ServiceContext) {
    this.context = context;
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
    };
  }

  async create(label: string, claims: string[]): Promise<{ secret: string; entry: Entry }> {
    const keyLabel = typeof label === "string" && label.trim() ? label.trim() : "API key";
    const { secret, info } = KeyUtils.generateKey(keyLabel, claims);

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

  async revoke(id: string): Promise<void> {
    await this.context.withWriteLock(() =>
      this.context.store.delete(Scope.System, KeyUtils.KeysCollection, id)
    );
  }

  async authenticate(secret: string): Promise<KeyInfo> {
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
    return { ...info, claims: Claims.normalize(info.claims) };
  }

  /** Mints the first root key on an instance that has none. Returns the empty
   *  string when keys already exist, so a restart announces nothing. */
  async bootstrap(): Promise<string> {
    if ((await this.list()).length > 0) return "";
    const { secret } = await this.create("root", [Claims.Root]);
    return secret;
  }
}
