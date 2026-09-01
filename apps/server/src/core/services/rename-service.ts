import type { ScopeRename } from "@silo/shared/claim-rewrite";
import { ConflictError } from "../errors/conflict-error";
import { NotFoundError } from "../errors/not-found-error";
import { Scope } from "../domain/scope";
import type { AuditActor } from "../audit/audit-actor";
import type { AuditService } from "./audit-service";
import type { CollectionService } from "./collection-service";
import type { ScopeService } from "./scope-service";
import type { ServiceContext } from "./support/service-context";
import { ScopeRenameCascade, type RenameCascadePlan } from "./support/scope-rename-cascade";

/** What a rename will do, answered before it is done. */
export interface RenamePreview {
  /** The record's id, so the caller can bind its mutation to it. */
  id: string;
  from: string;
  to: string;
  /** Claims that will be rewritten to follow the rename. */
  rewritten_claims: string[];
  /** Claims whose reach changes although nothing rewrites them, because they
   *  name the subject through a wildcard ancestor (D51). */
  pattern_affected_claims: string[];
}

/** The claims `silo.toml` declares per plugin, which a rename must not rewrite
 *  and therefore refuses to cascade past. */
export type DeclaredPluginClaims = ReadonlyMap<string, readonly string[]>

/**
 * Restarts the named plugins so a running one picks up its rewritten grant.
 *
 * Injected rather than reached for: the supervisor is the only thing that
 * mutates the plugin registry and it sits **above** this layer, so a service
 * importing it would invert the dependency direction `plugins/` is arranged in.
 */
export type PluginRefresh = (names: readonly string[]) => Promise<void>;

/**
 * Renaming a project, an environment or a collection (D51).
 *
 * One service rather than a method on each of the three, because the *order* is
 * the hard part and it is the same order every time: refuse, plan the claim
 * cascade, check the config half, rename the record, cascade, audit. Splitting
 * it three ways would be three copies of that order to keep in step.
 */
export class RenameService {
  private readonly context: ServiceContext;
  private readonly scopes: ScopeService;
  private readonly collections: CollectionService;
  private readonly audit: AuditService;
  private readonly cascade: ScopeRenameCascade;

  /**
   * Read from the config the process started on, and empty when nothing was
   * supplied — an embedder with no `silo.toml` has no declared claims to
   * conflict with.
   */
  private declared: DeclaredPluginClaims = new Map();

  /** A no-op for a process with no plugin host — a CLI subcommand, a test, an
   *  embedder — where there is nothing running to refresh. */
  private refreshPlugins: PluginRefresh = async () => {};

  constructor(
    context: ServiceContext,
    scopes: ScopeService,
    collections: CollectionService,
    audit: AuditService,
    cascade: ScopeRenameCascade
  ) {
    this.context = context;
    this.scopes = scopes;
    this.collections = collections;
    this.audit = audit;
    this.cascade = cascade;
  }

  /** Supplied by the wiring, which is the only layer that reads `silo.toml`. */
  useDeclaredPluginClaims(declared: DeclaredPluginClaims): void {
    this.declared = declared;
  }

  /** Supplied by the wiring, which owns the plugin supervisor. */
  usePluginRefresh(refresh: PluginRefresh): void {
    this.refreshPlugins = refresh;
  }

  async previewProject(from: string, to: string): Promise<RenamePreview> {
    const record = await this.requireProject(from);
    return this.preview(record.id, RenameService.projectRename(from, to));
  }

  async previewEnvironment(project: string, from: string, to: string): Promise<RenamePreview> {
    const record = await this.requireEnvironment(project, from);
    return this.preview(record.id, RenameService.environmentRename(project, from, to));
  }

  async previewCollection(scope: Scope, from: string, to: string): Promise<RenamePreview> {
    const record = await this.collections.get(scope, from);
    return this.preview(record.id, RenameService.collectionRename(scope, from, to));
  }

  async renameProject(
    from: string,
    to: string,
    actor: AuditActor,
    expectedId?: string
  ): Promise<RenamePreview> {
    const record = await this.requireProject(from);
    RenameService.assertExpectedId(record.id, expectedId, "project", from);

    const rename = RenameService.projectRename(from, to);
    const plan = await this.prepare(rename);

    await this.scopes.renameProject(record.id, to);
    await this.applyCascade(plan);
    await this.record("project.rename", actor, record.id, plan);

    return RenameService.previewOf(record.id, plan);
  }

  async renameEnvironment(
    project: string,
    from: string,
    to: string,
    actor: AuditActor,
    expectedId?: string
  ): Promise<RenamePreview> {
    const record = await this.requireEnvironment(project, from);
    RenameService.assertExpectedId(record.id, expectedId, "environment", `${project}/${from}`);

    const rename = RenameService.environmentRename(project, from, to);
    const plan = await this.prepare(rename);

    await this.scopes.renameEnvironment(record.id, to);
    await this.applyCascade(plan);
    await this.record("environment.rename", actor, record.id, plan);

    return RenameService.previewOf(record.id, plan);
  }

  async renameCollection(
    scope: Scope,
    from: string,
    to: string,
    actor: AuditActor,
    expectedId?: string
  ): Promise<RenamePreview> {
    const record = await this.collections.get(scope, from);
    RenameService.assertExpectedId(
      record.id,
      expectedId,
      "collection",
      `${scope.key()}/${from}`
    );

    const rename = RenameService.collectionRename(scope, from, to);
    const plan = await this.prepare(rename);

    await this.collections.rename(scope, record.id, from, to);
    await this.applyCascade(plan);
    await this.record("collection.rename", actor, record.id, plan);

    return RenameService.previewOf(record.id, plan);
  }

  /**
   * Everything that must be true before anything is written: the old name is
   * not held by an unfinished cascade, the new name is not either, and no
   * `silo.toml` claim names the subject.
   */
  private async prepare(rename: ScopeRename): Promise<RenameCascadePlan> {
    if (rename.from === rename.to) {
      throw new ConflictError(`"${rename.from}" is already the name`);
    }
    await this.cascade.assertNameFree(rename.subject, rename.from);
    await this.cascade.assertNameFree(rename.subject, rename.to);

    const plan = await this.cascade.plan(rename);
    ScopeRenameCascade.assertConfigClean(this.declared, rename);
    return plan;
  }

  /**
   * Rewrites the claims, then restarts any plugin whose grant moved.
   *
   * The restart comes **after** the rewrite and not instead of it: the record is
   * what the next start reads, so refreshing without rewriting would put the
   * plugin back on the same stale claims. A refresh that fails does not fail the
   * rename — the authority on record is already correct, and the plugin picks it
   * up at the next start either way.
   */
  private async applyCascade(plan: RenameCascadePlan): Promise<void> {
    await this.cascade.apply(plan);
    if (plan.pluginNames.length === 0) return;

    try {
      await this.refreshPlugins(plan.pluginNames);
    } catch {
      // Deliberately swallowed; see above.
    }
  }

  private async preview(id: string, rename: ScopeRename): Promise<RenamePreview> {
    return RenameService.previewOf(id, await this.cascade.plan(rename));
  }

  private async record(
    action: "project.rename" | "environment.rename" | "collection.rename",
    actor: AuditActor,
    subject: string,
    plan: RenameCascadePlan
  ): Promise<void> {
    await this.audit.record(action, actor, subject, {
      from: plan.rename.from,
      to: plan.rename.to,
      rewritten_claims: plan.rewritten,
      pattern_affected_claims: plan.patternAffected,
    });
  }

  private async requireProject(name: string) {
    const record = await this.scopes.findProject(name);
    if (!record) throw new NotFoundError(`project "${name}" not found`);
    return record;
  }

  private async requireEnvironment(project: string, env: string) {
    const record = await this.scopes.findEnvironment(project, env);
    if (!record) throw new NotFoundError(`environment "${project}/${env}" not found`);
    return record;
  }

  /**
   * A name-addressed mutation can arrive after the thing it named was renamed
   * and something else took the name. `expected_id` is how a caller says which
   * record it meant.
   */
  private static assertExpectedId(
    actual: string,
    expected: string | undefined,
    label: string,
    named: string
  ): void {
    if (expected === undefined || expected === actual) return;
    throw new ConflictError(
      `${label} "${named}" has id "${actual}", not the expected "${expected}"; it was renamed or replaced since you last read it`
    );
  }

  private static previewOf(id: string, plan: RenameCascadePlan): RenamePreview {
    return {
      id,
      from: plan.rename.from,
      to: plan.rename.to,
      rewritten_claims: plan.rewritten,
      pattern_affected_claims: plan.patternAffected,
    };
  }

  private static projectRename(from: string, to: string): ScopeRename {
    return { subject: "project", from, to, project: from };
  }

  private static environmentRename(project: string, from: string, to: string): ScopeRename {
    return { subject: "environment", from, to, project, env: from };
  }

  private static collectionRename(scope: Scope, from: string, to: string): ScopeRename {
    return {
      subject: "collection",
      from,
      to,
      project: scope.project,
      env: scope.env,
    };
  }
}
