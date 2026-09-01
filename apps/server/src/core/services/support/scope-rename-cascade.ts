import { ClaimRewrite, type ScopeRename } from "@silo/shared/claim-rewrite";
import { ConflictError } from "../../errors/conflict-error";
import type { Entry } from "../../domain/entry";
import { EntryUtils } from "../../domain/entry-utils";
import { Scope } from "../../domain/scope";
import { SystemCollections } from "../../domain/system-collections";
import type { ServiceContext } from "./service-context";

/** What a rename would do to the claim strings on record. */
export interface RenameCascadePlan {
  rename: ScopeRename;
  /** `_keys` entry ids whose claims change. */
  keys: string[];
  /** `_plugins` entry ids whose claim lists change. */
  plugins: string[];
  /**
   * The plugin **names** behind those ids.
   *
   * Rewriting the record is not the whole job: a running plugin holds the
   * authority it booted with, so it has to be restarted or it keeps acting on
   * claims naming a scope that no longer exists. The names are what the
   * supervisor works in, and it lives above this layer, so they are reported
   * rather than acted on here.
   */
  pluginNames: string[];
  /** Distinct claims that will be rewritten, for the caller to report. */
  rewritten: string[];
  /** Distinct claims whose reach changes without being rewritten, because they
   *  name the subject through a wildcard ancestor. Disclosed, never rewritten. */
  patternAffected: string[];
}

/** The claim lists a `_plugins` record carries, in the order they are written
 *  back. */
const PluginClaimFields = ["requested", "granted", "required"] as const;

/**
 * Rewriting the claim strings that name a renamed project, environment or
 * collection (D51).
 *
 * Claims stay name-based — a ULID fails the claim grammar's id pattern, and
 * ULID claims would be unreadable and would break the cross-instance key
 * portability `--with-keys` exists for — so this is the one cascade the record
 * model does not remove.
 *
 * It is **staged**, because `_keys` and `_plugins` are entries and no adapter
 * can write them transactionally with a scope record: a `_scope_renames` marker
 * is written before the first rewrite and cleared after the last, and
 * `resumePending` finishes it at the next start. The marker carries the
 * enumerated record **ids** rather than only `from`/`to`, so a replay works
 * through a fixed worklist instead of re-deriving "claims still naming `from`" —
 * which would rewrite the wrong records if a new project took the freed name
 * first.
 *
 * The marker doubles as a **name reservation**: while one is pending the old
 * name cannot be taken. That is what makes the replay safe to be non-fatal, in
 * the way D23's and D49's resumes already are.
 */
export class ScopeRenameCascade {
  private readonly context: ServiceContext;

  constructor(context: ServiceContext) {
    this.context = context;
  }

  /**
   * What the rename would change, without changing anything.
   *
   * Read by the preflight route, by the authority check — which needs to know
   * whether anything is rewritten at all before asking for the extra claims —
   * and by `apply`, so the worklist the marker records is the one the check
   * was made against.
   */
  async plan(rename: ScopeRename): Promise<RenameCascadePlan> {
    const rewritten = new Set<string>();
    const patternAffected = new Set<string>();
    const keys: string[] = [];
    const plugins: string[] = [];
    const pluginNames: string[] = [];

    for (const entry of await this.readAll(SystemCollections.Keys)) {
      const outcome = ClaimRewrite.plan(ScopeRenameCascade.claimsOf(entry.data?.claims), rename);
      outcome.rewritten.forEach((claim) => rewritten.add(claim));
      outcome.patternAffected.forEach((claim) => patternAffected.add(claim));
      if (outcome.rewritten.length > 0) keys.push(entry.id);
    }

    for (const entry of await this.readAll(SystemCollections.Plugins)) {
      let changed = false;
      for (const field of PluginClaimFields) {
        const outcome = ClaimRewrite.plan(ScopeRenameCascade.claimsOf(entry.data?.[field]), rename);
        outcome.rewritten.forEach((claim) => rewritten.add(claim));
        outcome.patternAffected.forEach((claim) => patternAffected.add(claim));
        if (outcome.rewritten.length > 0) changed = true;
      }
      if (changed) {
        plugins.push(entry.id);
        if (typeof entry.data?.name === "string") pluginNames.push(entry.data.name);
      }
    }

    return {
      rename,
      keys,
      plugins,
      pluginNames,
      rewritten: [...rewritten].sort(),
      patternAffected: [...patternAffected].sort(),
    };
  }

  /**
   * Refuses the rename when a claim declared in `silo.toml` names the subject
   * literally.
   *
   * D34 keeps plugin registration in the config file on purpose, and states why
   * the API must not write it: "an API that could write the file would be a
   * code-execution primitive wearing a management claim". Effective plugin
   * authority is `silo.toml` **union** the `_plugins` record
   * (`PluginGrantResolver`), so a rename that rewrote only the record half would
   * leave the file half naming a scope that no longer exists — and rewriting the
   * file half is the thing D34 forbids. So this refuses, names the blocks, and
   * leaves the edit to the operator.
   */
  static assertConfigClean(
    declared: ReadonlyMap<string, readonly string[]>,
    rename: ScopeRename
  ): void {
    const blocking: string[] = [];
    for (const [name, claims] of declared) {
      if (ClaimRewrite.plan(claims, rename).rewritten.length > 0) blocking.push(name);
    }
    if (blocking.length === 0) return;

    throw new ConflictError(
      `silo.toml declares claims naming "${rename.from}" for plugin${blocking.length === 1 ? "" : "s"} ${blocking
        .map((name) => `"${name}"`)
        .join(", ")}; silo does not rewrite [[plugins]] claims, so edit the file first (see D34) and retry`
    );
  }

  /**
   * Stages the marker, rewrites every record on the worklist, clears the marker.
   *
   * The caller holds the write lock and has already renamed the record itself:
   * the claims follow the rename rather than leading it, so a claim never names
   * a scope that does not exist yet.
   */
  async apply(plan: RenameCascadePlan): Promise<void> {
    if (plan.keys.length === 0 && plan.plugins.length === 0) return;

    const marker = await this.stage(plan);
    try {
      await this.rewriteRecords(plan);
    } finally {
      await this.clear(marker);
    }
  }

  /**
   * Finishes any cascade a crash left half-applied.
   *
   * Failures are counted rather than thrown, the way `MediaDeletionService` and
   * `MediaFolderMoveService` already resume: a cascade staged days ago must not
   * stop the server booting. That is only safe because the marker reserves the
   * old name while it stands, so nothing can have taken it in the meantime.
   */
  async resumePending(): Promise<{ resumed: number; failed: number }> {
    let resumed = 0;
    let failed = 0;

    for (const marker of await this.readAll(SystemCollections.ScopeRenames)) {
      try {
        await this.rewriteRecords(ScopeRenameCascade.planOf(marker));
        await this.clear(marker.id);
        resumed++;
      } catch {
        failed++;
      }
    }
    return { resumed, failed };
  }

  /**
   * Whether a pending cascade still holds this name, so a create must refuse it.
   *
   * Checked by `createProject`, `createEnvironment` and `putSchema`. Without it
   * a replay could rewrite claims that legitimately point at a *new* record
   * which took the freed name, which is the one thing the enumerated worklist
   * alone cannot prevent — the ids would be right and the meaning wrong.
   */
  async reservedNames(subject: ScopeRename["subject"]): Promise<Set<string>> {
    const held = new Set<string>();
    for (const marker of await this.readAll(SystemCollections.ScopeRenames)) {
      const pending = ScopeRenameCascade.planOf(marker).rename;
      if (pending.subject === subject) held.add(pending.from);
    }
    return held;
  }

  async assertNameFree(subject: ScopeRename["subject"], name: string): Promise<void> {
    if (!(await this.reservedNames(subject)).has(name)) return;
    throw new ConflictError(
      `the name "${name}" is held by a rename that has not finished its claim rewrite; it is released once that completes`
    );
  }

  private async stage(plan: RenameCascadePlan): Promise<string> {
    const now = EntryUtils.now();
    const entry: Entry = {
      id: EntryUtils.newID(),
      project: Scope.System.project,
      env: Scope.System.env,
      collection: SystemCollections.ScopeRenames,
      rev: 1,
      seq: 0,
      created_at: now,
      updated_at: now,
      data: {
        rename: plan.rename,
        keys: plan.keys,
        plugins: plan.plugins,
        plugin_names: plan.pluginNames,
      },
    };
    await this.context.store.put(entry, { usages: [], search: null });
    return entry.id;
  }

  private async clear(id: string): Promise<void> {
    await this.context.store
      .delete(Scope.System, SystemCollections.ScopeRenames, id)
      .catch(() => {});
  }

  /**
   * Idempotent by construction: rewriting an already-rewritten claim list is a
   * no-op, since no literal segment still names `from`.
   */
  private async rewriteRecords(plan: RenameCascadePlan): Promise<void> {
    for (const id of plan.keys) {
      await this.rewriteEntry(SystemCollections.Keys, id, (data) => {
        const claims = ScopeRenameCascade.claimsOf(data.claims);
        return { ...data, claims: ClaimRewrite.plan(claims, plan.rename).claims };
      });
    }

    for (const id of plan.plugins) {
      await this.rewriteEntry(SystemCollections.Plugins, id, (data) => {
        const next: Record<string, unknown> = { ...data };
        for (const field of PluginClaimFields) {
          if (!Array.isArray(data[field])) continue;
          next[field] = ClaimRewrite.plan(
            ScopeRenameCascade.claimsOf(data[field]),
            plan.rename
          ).claims;
        }
        return next;
      });
    }
  }

  private async rewriteEntry(
    collection: string,
    id: string,
    change: (data: any) => any
  ): Promise<void> {
    const entry = await this.context.store.get(Scope.System, collection, id);
    await this.context.store.put(
      {
        ...entry,
        rev: entry.rev + 1,
        updated_at: EntryUtils.now(),
        data: change(entry.data),
      },
      { usages: [], search: null }
    );
  }

  private async readAll(collection: string): Promise<Entry[]> {
    const { items } = await this.context.store.list(Scope.System, collection, {
      limit: ScopeRenameCascade.PageLimit,
      offset: 0,
    });
    return items;
  }

  /** `_keys`, `_plugins` and `_scope_renames` are all small by nature — one
   *  page is the whole of each in every instance that exists. */
  private static readonly PageLimit = 5000;

  private static planOf(marker: Entry): RenameCascadePlan {
    const data = marker.data ?? {};
    return {
      rename: data.rename,
      keys: Array.isArray(data.keys) ? data.keys : [],
      plugins: Array.isArray(data.plugins) ? data.plugins : [],
      pluginNames: Array.isArray(data.plugin_names) ? data.plugin_names : [],
      rewritten: [],
      patternAffected: [],
    };
  }

  private static claimsOf(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((claim) => typeof claim === "string") : [];
  }
}
