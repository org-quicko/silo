import { VariableName } from "@silo/shared/variable-name";
import { ValidationError } from "@silo/shared/validation-error";
import type { Scope } from "../domain/scope";
import { ConflictError } from "../errors/conflict-error";
import { NotFoundError } from "../errors/not-found-error";
import type { VariableRecord } from "../variables/variable-record";
import { VariableRefs } from "../variables/variable-refs";
import type { VariableView } from "../variables/variable-view";
import { VariableValues } from "../variables/variable-values";
import type { ServiceContext } from "./support/service-context";
import type { StoredVariable } from "./support/variable-store";
import { VariableStore } from "./support/variable-store";

/**
 * Variables: declared once per project, valued per environment, substituted
 * into `{{NAME}}` on the way out (D57).
 *
 * The split of authority this service assumes is the one the routes enforce:
 * **declaring** a name reaches every environment in the project, **valuing** it
 * reaches one. Nothing here checks a claim — that is `RouteAuth`'s job at the
 * boundary, as everywhere else — but the methods are cut along that line so a
 * route cannot offer one reach under the other's authority.
 *
 * Not audited, deliberately. `AuditAction` is a trail of **authority** changes
 * and says in its own words that entry writes stay out of it because `rev` and
 * `updated_at` already record them. A variable's value is content: it changes
 * what entries say, not who may do what, and every declaration carries its own
 * `rev` and `updated_at` for the same reason an entry does.
 */
export class VariableService {
  /** Room for a connection string or a long URL, and far short of a document.
   *  A variable substitutes into every entry that references it, so an
   *  unbounded one is a way to make every response arbitrarily large. */
  private static readonly MaxValueLength = 4_096;
  private static readonly MaxDescriptionLength = 512;

  private readonly context: ServiceContext;
  private readonly store: VariableStore;

  constructor(context: ServiceContext) {
    this.context = context;
    this.store = new VariableStore(context);
  }

  /**
   * The values a response in `scope` substitutes through — and **nothing is
   * read when nothing is referenced**.
   *
   * This is where the efficient-lookup requirement is actually met, and it is
   * met twice over. Content holding no `{{…}}` costs zero storage reads, the
   * early-out `MediaLinkResolver` takes for a payload naming no asset. Content
   * that does reference something costs **one filtered read for the whole
   * response**, however many references it holds, because a project's
   * declarations are one document each and arrive together — there is no join
   * to do, which is the property `VariableRecord`'s shape was chosen for.
   */
  async forPayload(scope: Scope, payload: unknown): Promise<VariableValues> {
    if (VariableRefs.extract(payload).length === 0) return VariableValues.Empty;
    return this.valuesFor(scope);
  }

  /** Every value in force in one scope. `forPayload` is what routes want; this
   *  is the unconditional read behind it, for a caller that already knows it
   *  needs one. */
  async valuesFor(scope: Scope): Promise<VariableValues> {
    const ids = await this.resolveIds(scope);
    if (!ids) return VariableValues.Empty;

    const stored = await this.store.listForProject(ids.projectId);
    const values = new Map<string, string>();
    const declared: string[] = [];
    for (const { record } of stored) {
      if (!record.name) continue;
      declared.push(record.name);
      const value = record.values[ids.environmentId];
      if (typeof value === "string") values.set(record.name, value);
    }
    return VariableValues.of(values, declared);
  }

  /** Every declaration in the project, as this environment sees it. */
  async list(scope: Scope): Promise<VariableView[]> {
    const ids = await this.resolveIds(scope);
    if (!ids) return [];

    const stored = await this.store.listForProject(ids.projectId);
    return stored
      .filter(({ record }) => record.name.length > 0)
      .map((entry) => VariableService.view(entry, ids.environmentId))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  /**
   * Declares a name in the project, optionally valuing it in `scope`'s
   * environment in the same call.
   *
   * One call rather than a declare followed by a set, because the admin's "Add
   * variable" form collects both and two requests would leave a declared name
   * with no value behind a failed second half. A caller holding only the value
   * authority cannot reach this — see the class comment.
   */
  async declare(
    scope: Scope,
    name: string,
    description = "",
    value?: string,
  ): Promise<VariableView> {
    VariableName.assert(name);
    VariableService.assertDescription(description);
    if (value !== undefined) VariableService.assertValue(value);

    const ids = await this.requireIds(scope);
    return this.context.withWriteLock(async () => {
      if (await this.store.find(ids.projectId, name)) {
        throw new ConflictError(
          `variable "${name}" is already declared in project "${scope.project}"`,
        );
      }
      const record: VariableRecord = {
        project_id: ids.projectId,
        name,
        description,
        values: value === undefined ? {} : { [ids.environmentId]: value },
      };
      const written = await this.store.create(record);
      return VariableService.view(written, ids.environmentId);
    });
  }

  /**
   * Renames a declaration or rewrites its description.
   *
   * A rename here is **not** the cascade D51 runs for a project or a
   * collection: nothing but content references a variable name, and content is
   * not rewritten — every `{{OLD}}` already written keeps standing as an
   * unresolved reference rather than silently following the name to a value it
   * was never pointed at. The admin warns before it happens.
   */
  async updateDeclaration(
    scope: Scope,
    name: string,
    changes: { name?: string; description?: string },
  ): Promise<VariableView> {
    if (changes.name !== undefined) VariableName.assert(changes.name);
    if (changes.description !== undefined) VariableService.assertDescription(changes.description);
    if (changes.name === undefined && changes.description === undefined) {
      throw new ValidationError("nothing to update: want {name} or {description}");
    }

    const ids = await this.requireIds(scope);
    return this.context.withWriteLock(async () => {
      const stored = await this.require(ids.projectId, scope, name);
      const renameTo = changes.name !== undefined && changes.name !== name ? changes.name : null;
      if (renameTo !== null && (await this.store.find(ids.projectId, renameTo))) {
        throw new ConflictError(
          `variable "${renameTo}" is already declared in project "${scope.project}"`,
        );
      }
      const written = await this.store.replace(stored, {
        ...stored.record,
        name: changes.name ?? stored.record.name,
        description: changes.description ?? stored.record.description,
      });
      return VariableService.view(written, ids.environmentId);
    });
  }

  /** Forgets the declaration and every environment's value with it. */
  async undeclare(scope: Scope, name: string): Promise<void> {
    const ids = await this.requireIds(scope);
    await this.context.withWriteLock(async () => {
      const stored = await this.require(ids.projectId, scope, name);
      await this.store.delete(stored.entry.id);
    });
  }

  /** Sets this environment's value, leaving every other environment's alone. */
  async setValue(scope: Scope, name: string, value: string): Promise<VariableView> {
    VariableService.assertValue(value);
    const ids = await this.requireIds(scope);

    return this.context.withWriteLock(async () => {
      const stored = await this.require(ids.projectId, scope, name);
      const written = await this.store.replace(stored, {
        ...stored.record,
        values: { ...stored.record.values, [ids.environmentId]: value },
      });
      return VariableService.view(written, ids.environmentId);
    });
  }

  /**
   * Clears this environment's value, leaving the name declared.
   *
   * Deleting the key rather than writing `""`: the two are different states
   * (`VariableValues`), and an operator clearing a value means "this
   * environment has none", which puts `{{NAME}}` back in the response instead
   * of blanking the text it sits in.
   */
  async clearValue(scope: Scope, name: string): Promise<VariableView> {
    const ids = await this.requireIds(scope);

    return this.context.withWriteLock(async () => {
      const stored = await this.require(ids.projectId, scope, name);
      const values = { ...stored.record.values };
      delete values[ids.environmentId];
      const written = await this.store.replace(stored, { ...stored.record, values });
      return VariableService.view(written, ids.environmentId);
    });
  }

  /**
   * Drops one environment's values from every declaration in a project, called
   * when that environment is deleted.
   *
   * The declarations survive, because they belong to the project. Without this
   * a recreated `staging` would be a *new* record with a new id and would
   * correctly come up unset, while the old id's values stayed in the documents
   * forever — invisible, unreachable and carried by every export.
   */
  async forgetEnvironment(projectId: string, environmentId: string): Promise<number> {
    const stored = await this.store.listForProject(projectId);
    let cleared = 0;
    for (const held of stored) {
      if (!Object.hasOwn(held.record.values, environmentId)) continue;
      const values = { ...held.record.values };
      delete values[environmentId];
      await this.store.replace(held, { ...held.record, values });
      cleared += 1;
    }
    return cleared;
  }

  /** Drops every declaration in a project, called when the project is deleted. */
  async forgetProject(projectId: string): Promise<number> {
    const stored = await this.store.listForProject(projectId);
    for (const held of stored) await this.store.delete(held.entry.id);
    return stored.length;
  }

  private async require(projectId: string, scope: Scope, name: string): Promise<StoredVariable> {
    VariableName.assert(name);
    const stored = await this.store.find(projectId, name);
    if (!stored) {
      throw new NotFoundError(`variable "${name}" is not declared in project "${scope.project}"`);
    }
    return stored;
  }

  /** Both record ids, or null when either name does not resolve — a read that
   *  answers "nothing" rather than throwing, for the list path. */
  private async resolveIds(
    scope: Scope,
  ): Promise<{ projectId: string; environmentId: string } | null> {
    const project = await this.context.store.findProject(scope.project);
    if (!project) return null;
    const environment = await this.context.store.findEnvironment(scope.project, scope.env);
    if (!environment) return null;
    return { projectId: project.id, environmentId: environment.id };
  }

  private async requireIds(scope: Scope): Promise<{ projectId: string; environmentId: string }> {
    const ids = await this.resolveIds(scope);
    if (!ids) throw new NotFoundError(`scope "${scope.key()}" not found`);
    return ids;
  }

  private static view(stored: StoredVariable, environmentId: string): VariableView {
    const { record, entry } = stored;
    const value = record.values[environmentId];
    return {
      name: record.name,
      description: record.description,
      value: typeof value === "string" ? value : null,
      set_in: Object.keys(record.values).length,
      created_at: VariableService.iso(entry.created_at),
      updated_at: VariableService.iso(entry.updated_at),
    };
  }

  private static iso(at: Date | string | number): string {
    return at instanceof Date ? at.toISOString() : new Date(at).toISOString();
  }

  /**
   * A value is text and text only, with a ceiling.
   *
   * Substitution is textual, so a number or an object would have to be
   * stringified on the way in or out and the two would disagree — `{{PORT}}`
   * inside a sentence and `{{PORT}}` as a whole field would produce different
   * types from the same stored value. A caller wanting a number keeps the field
   * typed and writes the literal.
   */
  private static assertValue(value: unknown): asserts value is string {
    if (typeof value !== "string") {
      throw new ValidationError("invalid value: must be a string");
    }
    if (value.length > VariableService.MaxValueLength) {
      throw new ValidationError(
        `invalid value: too long (max ${VariableService.MaxValueLength} characters)`,
      );
    }
  }

  private static assertDescription(description: unknown): asserts description is string {
    if (typeof description !== "string") {
      throw new ValidationError("invalid description: must be a string");
    }
    if (description.length > VariableService.MaxDescriptionLength) {
      throw new ValidationError(
        `invalid description: too long (max ${VariableService.MaxDescriptionLength} characters)`,
      );
    }
  }
}
