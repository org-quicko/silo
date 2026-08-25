import { Claims } from "@silo/shared/claims";
import { ValidationError } from "@silo/shared/validation-error";
import type { Claim } from "@silo/shared/claim";
import type { Entry } from "../domain/entry";
import { EntryUtils } from "../domain/entry-utils";
import { Scope } from "../domain/scope";
import { ForbiddenError } from "../errors/forbidden-error";
import { NotFoundError } from "../errors/not-found-error";
import type { PluginGrant } from "../plugins/plugin-grant";
import { PluginGrantUtils } from "../plugins/plugin-grant-utils";
import type { GrantRequest } from "./support/grant-request";
import type { KeyService } from "./key-service";
import type { ServiceContext } from "./support/service-context";

/**
 * What each plugin is allowed to do, and the managed key that carries it
 * (D34).
 *
 * Grants live in `_plugins` rather than in `silo.toml` because the two answer
 * different questions and want opposite storage. **Registration** — which
 * plugins load and in what order — stays in the operator's file, so that
 * whoever can write the database cannot thereby execute code. **Authorization**
 * lives here, so that withdrawing it takes effect now rather than at the next
 * restart, and so that who granted what is recorded.
 */
export class PluginGrantService {
  /** More plugins than any instance is expected to run; listing is unpaged. */
  private static readonly ListLimit = 200;

  private readonly context: ServiceContext;
  private readonly keys: KeyService;

  constructor(context: ServiceContext, keys: KeyService) {
    this.context = context;
    this.keys = keys;
  }

  async list(): Promise<PluginGrant[]> {
    const { items } = await this.context.store.list(
      Scope.System,
      PluginGrantUtils.PluginsCollection,
      {
        sort: [{ path: "$.data.name", desc: false }],
        limit: PluginGrantService.ListLimit,
        offset: 0,
      }
    );
    return items.map((entry) => entry.data as PluginGrant);
  }

  /** The grant for one plugin, or `null` when it has never been reconciled —
   *  which is what an installed-but-untouched package looks like. */
  async find(name: string): Promise<PluginGrant | null> {
    const entry = await this.findEntry(name);
    return entry ? (entry.data as PluginGrant) : null;
  }

  /**
   * Bring the record in line with what the package on disk now asks for, and
   * return it.
   *
   * Called for every configured plugin at every start, and it is where "an
   * upgrade never escalates" happens: a changed request moves a granted record
   * to `needs_review` and leaves `granted` exactly as it was. The plugin keeps
   * running on the authority it had, and the new claims are simply not in it.
   */
  async reconcile(
    name: string,
    requested: readonly string[],
    hooks: readonly string[]
  ): Promise<PluginGrant> {
    const digest = PluginGrantUtils.digest(requested, hooks);
    const existing = await this.findEntry(name);

    if (!existing) {
      return await this.write({
        name,
        requested: [...requested],
        hooks: [...hooks],
        granted: [],
        state: "pending",
        manifest_digest: digest,
        granted_by: null,
      });
    }

    const grant = existing.data as PluginGrant;
    const next: PluginGrant = {
      ...grant,
      requested: [...requested],
      hooks: [...hooks],
      state: PluginGrantUtils.stateFor(grant, digest),
    };

    // The digest is only advanced when nothing needs review, so the record keeps
    // pointing at the manifest the operator actually approved. Overwriting it
    // here would make the difference it exists to detect disappear on the next
    // start — the plugin would look approved for a request nobody read.
    if (next.state !== "needs_review") next.manifest_digest = digest;

    return await this.write(next, existing);
  }

  /**
   * Approve `claims` for a plugin and mint the key that carries them.
   *
   * Three refusals, in the order they are cheapest to explain: nothing beyond
   * what the package asked for, nothing the granter does not itself hold, and
   * nothing from the small set a plugin may never have.
   */
  async grant(name: string, claims: readonly string[], request: GrantRequest): Promise<PluginGrant> {
    const entry = await this.requireEntry(name);
    const grant = entry.data as PluginGrant;
    const granted = Claims.normalize([...claims]);

    const excess = PluginGrantUtils.ungranted(grant.requested, granted);
    if (excess.length > 0) {
      throw new ValidationError(
        `plugin "${name}" did not request ${excess.join(", ")}. A grant may not exceed ` +
          `what the manifest asks for — otherwise what an operator approves and what the ` +
          `package declared are two different lists.`
      );
    }

    PluginGrantUtils.assertGrantable(name, granted);

    if (request.claims && !Claims.canDelegate(request.claims, granted as Claim[])) {
      throw new ForbiddenError(
        `this key cannot grant plugin "${name}" more authority than it holds itself`
      );
    }

    // Minted before the record is written, so a failure to mint leaves the
    // grant untouched rather than pointing at a key that does not exist.
    if (grant.key_id) await this.keys.discard(grant.key_id).catch(() => {});
    const { entry: keyEntry } = await this.keys.create(`plugin:${name}`, [...granted], {
      kind: "plugin",
      name,
    });

    return await this.write(
      {
        ...grant,
        granted,
        state: "granted",
        // Approving is reading the request, so this is the one place the digest
        // advances past what `reconcile` refused to move.
        manifest_digest: PluginGrantUtils.digest(grant.requested, grant.hooks),
        key_id: keyEntry.id,
        granted_by: request.keyId ?? null,
        granted_at: EntryUtils.now().toISOString(),
      },
      entry
    );
  }

  /**
   * Withdraw a grant: the key goes first, then the record.
   *
   * That order is the point. Between the two writes the plugin holds a key id
   * that no longer resolves, which fails closed; the other order would leave a
   * live key behind a record that says `revoked`.
   */
  async revoke(name: string, request: GrantRequest): Promise<PluginGrant> {
    const entry = await this.requireEntry(name);
    const grant = entry.data as PluginGrant;

    if (grant.key_id) await this.keys.discard(grant.key_id).catch(() => {});

    return await this.write(
      {
        ...grant,
        granted: [],
        state: "revoked",
        key_id: undefined,
        granted_by: request.keyId ?? null,
        granted_at: EntryUtils.now().toISOString(),
      },
      entry
    );
  }

  private async findEntry(name: string): Promise<Entry | null> {
    const { items } = await this.context.store.list(
      Scope.System,
      PluginGrantUtils.PluginsCollection,
      {
        filter: { op: "eq", path: "$.data.name", value: name },
        limit: 1,
        offset: 0,
      }
    );
    return items[0] ?? null;
  }

  private async requireEntry(name: string): Promise<Entry> {
    const entry = await this.findEntry(name);
    if (!entry) {
      throw new NotFoundError(
        `plugin "${name}" is not known to this instance. Only a plugin listed in ` +
          `silo.toml can be granted — listing it is what makes it loadable at all.`
      );
    }
    return entry;
  }

  /** Insert or replace, in one place so the envelope is built once. */
  private async write(grant: PluginGrant, existing?: Entry | null): Promise<PluginGrant> {
    const now = EntryUtils.now();
    const entry: Entry = existing
      ? { ...existing, rev: existing.rev + 1, updated_at: now, data: grant }
      : {
          id: EntryUtils.newID(),
          project: Scope.System.project,
          env: Scope.System.env,
          collection: PluginGrantUtils.PluginsCollection,
          rev: 1,
          seq: 0,
          created_at: now,
          updated_at: now,
          data: grant,
        };

    await this.context.withWriteLock(() =>
      this.context.store.put(entry, { usages: [], search: null })
    );
    return grant;
  }
}
