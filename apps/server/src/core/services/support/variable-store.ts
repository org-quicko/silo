import type { Entry } from "../../domain/entry";
import { EntryUtils } from "../../domain/entry-utils";
import { Scope } from "../../domain/scope";
import { NotFoundError } from "../../errors/not-found-error";
import type { VariableRecord } from "../../variables/variable-record";
import { VariableRecords } from "../../variables/variable-record";
import type { ServiceContext } from "./service-context";

/** A declaration and the envelope it was read out of, so a writer can carry
 *  `rev` and `created_at` forward without a second read. */
export interface StoredVariable {
  entry: Entry;
  record: VariableRecord;
}

/**
 * Reads and writes the `_variables` documents (D57).
 *
 * `MediaCatalogStore`'s counterpart, and in `Scope.System` for the same reason
 * it is: a declaration belongs to a *project*, and a project is not a scope —
 * `Scope` is always a (project, env) pair, so there is no scope that means "all
 * of `acme`" to store one in. Keying the document by `project_id` instead is
 * what lets one declaration serve every environment beneath it, which is the
 * whole point of the feature.
 */
export class VariableStore {
  /** A project's variable list is operator-scale — tens, not thousands — so
   *  every read here wants all of them and one page is always enough. */
  private static readonly All = 10_000;

  private readonly context: ServiceContext;

  constructor(context: ServiceContext) {
    this.context = context;
  }

  get scope(): Scope {
    return Scope.System;
  }

  /** Every declaration in a project, filtered in storage rather than here so
   *  the fs adapter's per-query document read stays bounded by the instance's
   *  variables and not by anything else. */
  async listForProject(projectId: string): Promise<StoredVariable[]> {
    const { items } = await this.context.store.list(this.scope, VariableRecords.Collection, {
      filter: { op: "eq", path: "$.data.project_id", value: projectId },
      limit: VariableStore.All,
      offset: 0,
    });
    return items.map((entry) => ({ entry, record: VariableRecords.from(entry.data) }));
  }

  /** One declaration by project and name, or null. */
  async find(projectId: string, name: string): Promise<StoredVariable | null> {
    const found = await this.listForProject(projectId);
    return found.find((stored) => stored.record.name === name) ?? null;
  }

  /** Creates a declaration, answering the document written. */
  async create(record: VariableRecord): Promise<StoredVariable> {
    const now = EntryUtils.now();
    const entry: Entry = {
      id: EntryUtils.newID(),
      project: this.scope.project,
      env: this.scope.env,
      collection: VariableRecords.Collection,
      rev: 1,
      seq: 0,
      created_at: now,
      updated_at: now,
      data: record,
    };
    await this.context.store.put(entry, { usages: [], search: null });
    return { entry, record };
  }

  /** Replaces a declaration in place, carrying `created_at` and bumping `rev`. */
  async replace(stored: StoredVariable, record: VariableRecord): Promise<StoredVariable> {
    const entry: Entry = {
      ...stored.entry,
      rev: stored.entry.rev + 1,
      updated_at: EntryUtils.now(),
      data: record,
    };
    await this.context.store.put(entry, { usages: [], search: null });
    return { entry, record };
  }

  /** Forgets a declaration and every environment's value with it. A miss is
   *  not an error: the caller asked for it to be gone. */
  async delete(entryId: string): Promise<void> {
    try {
      await this.context.store.delete(this.scope, VariableRecords.Collection, entryId);
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
    }
  }
}
