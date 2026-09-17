import { SystemCollections } from "../domain/system-collections";
import { VariableRecords } from "../variables/variable-record";
import type { ParsedImport } from "./parsed-import";
import type { ScopedImport } from "./import-walker";
import type { TransferSelection } from "./transfer-selection";

/**
 * Narrows a walked archive to what the caller asked to load.
 *
 * Applied after the walk rather than inside it, so the walker keeps one job and
 * the rule lives in one place. What it drops is content — projects,
 * environments, collections — and the variable declarations belonging to the
 * projects it dropped, since a declaration whose project is not being loaded
 * has nothing to resolve against (§7.6).
 */
export class ImportFilter {
  static apply(parsed: ParsedImport, selection?: TransferSelection): ParsedImport {
    if (!selection || selection.isEverything) return parsed;

    const projects = (parsed.projects ?? []).filter((project) =>
      selection.coversProject(project.name)
    );
    // Archive-side ids, which is what `_variables` documents point at.
    const projectIds = new Set(
      projects.map((project) => project.id).filter((id): id is string => !!id)
    );

    const scopes: ScopedImport[] = [];
    for (const scoped of parsed.scopes) {
      if (scoped.scope.isSystem()) {
        scopes.push(ImportFilter.system(scoped, projectIds));
        continue;
      }
      if (!selection.coversScope(scoped.scope)) continue;
      scopes.push(ImportFilter.content(scoped, selection));
    }

    return { manifest: parsed.manifest, projects, scopes };
  }

  private static content(scoped: ScopedImport, selection: TransferSelection): ScopedImport {
    const keeps = (collection: string) => selection.coversCollection(scoped.scope, collection);
    return {
      ...scoped,
      schemas: new Map([...scoped.schemas].filter(([name]) => keeps(name))),
      entries: new Map([...scoped.entries].filter(([name]) => keeps(name))),
    };
  }

  /**
   * `_system` is never addressable by a selection — what rides from it is
   * decided by the media mode and by `with_keys`, not by a name an operator can
   * type. Only its variables are narrowed, and only because they carry the
   * project they belong to.
   */
  private static system(scoped: ScopedImport, projectIds: ReadonlySet<string>): ScopedImport {
    const variables = scoped.entries.get(SystemCollections.Variables);
    if (!variables) return scoped;

    const entries = new Map(scoped.entries);
    entries.set(
      SystemCollections.Variables,
      variables.filter((entry) => projectIds.has(VariableRecords.from(entry.data).project_id))
    );
    return { ...scoped, entries };
  }
}
