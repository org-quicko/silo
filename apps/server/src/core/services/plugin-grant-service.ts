import { Claims } from "@silo/shared/claims";
import { ValidationError } from "@silo/shared/validation-error";
import type { Claim } from "@silo/shared/claim";
import type { Entry } from "../domain/entry";
import { EntryUtils } from "../domain/entry-utils";
import { Scope } from "../domain/scope";
import { ConflictError } from "../errors/conflict-error";
import { ForbiddenError } from "../errors/forbidden-error";
import { NotFoundError } from "../errors/not-found-error";
import type { AuditActor } from "../audit/audit-actor";
import type { PluginGrant } from "../plugins/plugin-grant";
import type { PluginGrantRecord } from "../plugins/plugin-grant-record";
import { PluginGrantUtils } from "../plugins/plugin-grant-utils";
import type { AuditService } from "./audit-service";
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
 *
 * D42 gave the API a verb that writes the file, and did not weaken that split —
 * it leaned on it. `PluginInstallation` appends a block with `claims = []` and
 * routes every claim through this service, precisely because the file half of an
 * effective grant passes none of what is below: not `assertGrantable`, not
 * `canDelegate`, not the trail, and not `revoke`.
 *
 * Every mutation here appends to the trail (D38) and every mutation may be
 * fenced with a revision. Both are properties of the service and not of the
 * route, so the offline CLI gets them for free.
 */
export class PluginGrantService {
  /** More plugins than any instance is expected to run; listing is unpaged. */
  private static readonly ListLimit = 200;

  private readonly context: ServiceContext;
  private readonly keys: KeyService;
  private readonly audit: AuditService;

  constructor(context: ServiceContext, keys: KeyService, audit: AuditService) {
    this.context = context;
    this.keys = keys;
    this.audit = audit;
  }

  async list(): Promise<PluginGrantRecord[]> {
    const { items } = await this.context.store.list(
      Scope.System,
      PluginGrantUtils.PluginsCollection,
      {
        sort: [{ path: "$.data.name", desc: false }],
        limit: PluginGrantService.ListLimit,
        offset: 0,
      }
    );
    return items.map(PluginGrantService.toRecord);
  }

  /** The grant for one plugin, or `null` when it has never been reconciled —
   *  which is what an installed-but-untouched package looks like. */
  async find(name: string): Promise<PluginGrantRecord | null> {
    const entry = await this.findEntry(name);
    return entry ? PluginGrantService.toRecord(entry) : null;
  }

  /**
   * Bring the record in line with what the package on disk now asks for, and
   * return it.
   *
   * Called for every configured plugin at every start, and it is where "an
   * upgrade never escalates" happens: a changed request moves a granted record
   * to `needs_review` and leaves `granted` exactly as it was. The plugin keeps
   * running on the authority it had, and the new claims are simply not in it.
   *
   * Deliberately **not audited**. Reconciling is silo noticing what a package
   * says, not a person deciding anything, and one line per plugin per start
   * would bury the decisions the trail exists to hold. The decision that follows
   * from a `needs_review` — approving the new request — is audited, and that is
   * the entry worth having.
   *
   * `required` defaults to `requested`, which is what the whole request meant
   * before D36 split it: there was no optional, so everything asked for was
   * needed. A caller with a manifest in hand passes both.
   *
   * `routes` defaults to none for the same kind of reason (D41): a caller that
   * has no manifest has nothing to say about the route surface, and saying
   * "none" is the reading that cannot accidentally approve one.
   */
  async reconcile(
    name: string,
    requested: readonly string[],
    hooks: readonly string[],
    required: readonly string[] = requested,
    routes: readonly string[] = []
  ): Promise<PluginGrantRecord> {
    const digest = PluginGrantUtils.digest(requested, required, hooks, routes);
    const existing = await this.findEntry(name);

    if (!existing) {
      return await this.write(name, {
        name,
        requested: [...requested],
        required: [...required],
        hooks: [...hooks],
        routes: [...routes],
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
      required: [...required],
      hooks: [...hooks],
      routes: [...routes],
      state: PluginGrantUtils.stateFor(grant, digest),
    };

    // The digest is only advanced when nothing needs review, so the record keeps
    // pointing at the manifest the operator actually approved. Overwriting it
    // here would make the difference it exists to detect disappear on the next
    // start — the plugin would look approved for a request nobody read.
    if (next.state !== "needs_review") next.manifest_digest = digest;

    // A reconcile that changes nothing writes nothing. Reconciling runs for
    // every plugin at every start, so an unconditional write would bump the
    // revision on each one — invalidating every `If-Match` an operator was
    // holding, for no change they could point at. Measured against a running
    // instance, where four restarts had walked one plugin from rev 1 to rev 7.
    if (PluginGrantService.same(grant, next)) return PluginGrantService.toRecord(existing);

    return await this.write(name, next);
  }

  /**
   * Approve `claims` for a plugin and mint the key that carries them.
   *
   * Three refusals, in the order they are cheapest to explain: nothing beyond
   * what the package asked for, nothing the granter does not itself hold, and
   * nothing from the small set a plugin may never have.
   */
  async grant(
    name: string,
    claims: readonly string[],
    request: GrantRequest
  ): Promise<PluginGrantRecord> {
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

    // The old key survives until the new record is written, and the new one is
    // thrown away if that write is refused. Three orderings were possible and
    // only this one is safe at every step:
    //
    // - Discard-then-mint-then-write loses the live key when the write is
    //   refused, leaving the record pointing at a key that no longer exists.
    //   That is not hypothetical: a stale `If-Match` did exactly this.
    // - Write-then-rotate leaves the previous, possibly *wider* key live for a
    //   moment after the record says it was narrowed.
    //
    // So: mint, write, and only then withdraw what the write replaced. The
    // failure mode left is a key minted and immediately removed — harmless, and
    // recorded as both, because `keys.create` has already appended by the time
    // the write is refused and a trail showing a creation with no matching
    // removal would be a trail that lies.
    const { entry: keyEntry } = await this.keys.create(`plugin:${name}`, [...granted], {
      owner: { kind: "plugin", name },
      actor: request.actor,
    });

    let record: PluginGrantRecord;
    try {
      record = await this.write(
        name,
        {
          ...grant,
          granted,
          state: "granted",
          // Approving is reading the request, so this is the one place the
          // digest advances past what `reconcile` refused to move.
          manifest_digest: PluginGrantUtils.digest(
            grant.requested,
            PluginGrantUtils.requiredOf(grant),
            grant.hooks,
            PluginGrantUtils.routesOf(grant)
          ),
          key_id: keyEntry.id,
          granted_by: PluginGrantService.actorKey(request.actor),
          granted_at: EntryUtils.now().toISOString(),
        },
        request.expectedRev
      );
    } catch (caught) {
      await this.keys.discard(keyEntry.id).catch(() => {});
      await this.audit.record("key.revoke", request.actor, keyEntry.id, {
        label: `plugin:${name}`,
        reason: "the grant it was minted for was refused",
        cascaded: [],
      });
      throw caught;
    }

    if (grant.key_id) {
      await this.keys.discard(grant.key_id).catch(() => {});
      await this.audit.record("key.revoke", request.actor, grant.key_id, {
        label: `plugin:${name}`,
        reason: "replaced by a newly granted key",
        cascaded: [],
      });
    }

    await this.audit.record("plugin.grant", request.actor, name, {
      granted,
      requested: grant.requested,
      // The delta is the reviewable part: "approved everything" and "approved
      // two of nine" are different decisions and should not read the same.
      not_granted: PluginGrantUtils.missing(grant.requested, granted),
      key_id: keyEntry.id,
    });
    return record;
  }

  /**
   * Withdraw a grant: the key goes first, then the record.
   *
   * That order is the point. Between the two writes the plugin holds a key id
   * that no longer resolves, which fails closed; the other order would leave a
   * live key behind a record that says `revoked`.
   *
   * The revision is checked **before** the key goes, so a stale `If-Match` does
   * not destroy a credential on its way to a 409. `write` checks it again under
   * the lock, which is the authoritative one; this earlier check exists only so
   * the common refusal costs nothing.
   */
  async revoke(name: string, request: GrantRequest): Promise<PluginGrantRecord> {
    const entry = await this.requireEntry(name);
    const grant = entry.data as PluginGrant;
    PluginGrantService.assertRev(name, entry.rev, request.expectedRev);

    if (grant.key_id) {
      await this.keys.discard(grant.key_id).catch(() => {});
      await this.audit.record("key.revoke", request.actor, grant.key_id, {
        label: `plugin:${name}`,
        reason: "the plugin's grant was withdrawn",
        cascaded: [],
      });
    }

    const record = await this.write(
      name,
      {
        ...grant,
        granted: [],
        state: "revoked",
        key_id: undefined,
        granted_by: PluginGrantService.actorKey(request.actor),
        granted_at: EntryUtils.now().toISOString(),
      },
      request.expectedRev
    );

    await this.audit.record("plugin.revoke", request.actor, name, {
      // What it *had*, because the record now says `[]` and the question anyone
      // asks of a revocation later is what was taken away.
      withdrawn: grant.granted,
      key_id: grant.key_id ?? null,
    });
    return record;
  }

  /**
   * Turn a plugin off, or back on, for the next load (D38).
   *
   * Orthogonal to the grant: a disabled plugin keeps its claims and its managed
   * key, because pausing something is not the same decision as un-approving it,
   * and an operator who had to re-approve after every pause would learn to
   * approve widely to save the trouble.
   */
  async setEnabled(
    name: string,
    enabled: boolean,
    request: GrantRequest
  ): Promise<PluginGrantRecord> {
    const entry = await this.requireEntry(name);
    const grant = entry.data as PluginGrant;

    const record = await this.write(name, { ...grant, enabled }, request.expectedRev);
    await this.audit.record(
      enabled ? "plugin.enable" : "plugin.disable",
      request.actor,
      name,
      { state: grant.state }
    );
    return record;
  }

  /**
   * Set or clear the stored config override (D39, phase 4).
   *
   * `undefined` clears it, which is not the same as `{}`: cleared means
   * `silo.toml`'s block applies again, and empty means an operator deliberately
   * configured this plugin with nothing. A field that could not tell those apart
   * would make the file's block unreachable forever after the first `PATCH`.
   *
   * Nothing is validated here. The manifest that says what a valid config is
   * lives on disk, and this service reaches the store only (D34) — so the
   * supervisor validates, restarts, and then calls this, which is also the order
   * that keeps a refused write from leaving an unbootable record.
   */
  async setConfig(
    name: string,
    config: Record<string, unknown> | undefined,
    request: GrantRequest
  ): Promise<PluginGrantRecord> {
    const entry = await this.requireEntry(name);
    const grant = entry.data as PluginGrant;

    const next: PluginGrant = { ...grant };
    if (config === undefined) delete next.config;
    else next.config = config;

    const record = await this.write(name, next, request.expectedRev);
    await this.audit.record("plugin.configure", request.actor, name, {
      cleared: config === undefined,
      // The keys and not the values: a config is where a plugin's own secrets
      // live — an API token for the service it calls — and a trail that copied
      // them would become the credential store D38 says it must never be.
      keys: Object.keys(config ?? {}).sort(),
    });
    return record;
  }

  /**
   * Whether reconciling produced any change worth a revision.
   *
   * A structural comparison of the whole record rather than a field list: the
   * fields `reconcile` touches are exactly the ones that could differ, and a
   * hand-maintained list here would silently stop covering a field added later.
   * Both sides come from the same code path, so key order is stable.
   */
  private static same(before: PluginGrant, after: PluginGrant): boolean {
    return JSON.stringify(before) === JSON.stringify(after);
  }

  /**
   * The `If-Match` comparison, in one place so no two call sites word it
   * differently.
   *
   * Public since phase 4, because `PluginSupervisor` needs the same pre-flight
   * before it starts a worker it would otherwise have to stop again — and a
   * second copy of the comparison there is exactly what "one place" was for.
   */
  static assertRev(name: string, current: number, expected: number | undefined): void {
    if (expected === undefined || current === expected) return;
    throw new ConflictError(
      `rev mismatch for plugin "${name}": expected ${expected}, current is ${current}. ` +
        `Re-read it — what it asks for may have changed.`
    );
  }

  private static toRecord(entry: Entry): PluginGrantRecord {
    return { ...(entry.data as PluginGrant), rev: entry.rev };
  }

  /** `granted_by` from the actor, so the two can never disagree about who. */
  private static actorKey(actor: AuditActor): string | null {
    return actor.kind === "key" ? (actor.id ?? null) : null;
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

  /**
   * Insert or replace, re-reading **under the write lock**.
   *
   * The caller's copy was read outside the lock, so checking `expectedRev`
   * against it would compare against a revision that may already be stale — the
   * lost update `If-Match` exists to stop. `EntryService.update` makes the same
   * split for the same reason: the value the caller reasoned about is read
   * early, and the authoritative one is read late.
   */
  private async write(
    name: string,
    grant: PluginGrant,
    expectedRev?: number
  ): Promise<PluginGrantRecord> {
    return await this.context.withWriteLock(async () => {
      const current = await this.findEntry(name);
      PluginGrantService.assertRev(name, current?.rev ?? 0, expectedRev);

      const now = EntryUtils.now();
      const entry: Entry = current
        ? { ...current, rev: current.rev + 1, updated_at: now, data: grant }
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

      await this.context.store.put(entry, { usages: [], search: null });
      return { ...grant, rev: entry.rev };
    });
  }
}
