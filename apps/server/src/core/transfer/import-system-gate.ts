import { Claims } from "@silo/shared/claims";
import { ValidationError } from "@silo/shared/validation-error";
import { SystemCollections } from "../domain/system-collections";
import { ForbiddenError } from "../errors/forbidden-error";
import { VariableRecords } from "../variables/variable-record";
import { ImportAuthority } from "./import-authority";
import type { ImportEntries } from "./import-entries";
import { ImportGrants } from "./import-grants";
import type { ImportOptions } from "./import-options";
import type { ParsedImport } from "./parsed-import";

/**
 * What of an archive's `_system` half this caller may load (D84).
 *
 * Content is authorised at the route, per collection the selection names. A
 * system collection can never be named by a selection (§7.6), so until D84 only
 * `_keys` was gated at all, and a key holding `transfer:import` and write on one
 * collection could plant `_variables` for any project, forge `_audit` events,
 * or empty the audit trail with a whole-instance replace. Now each collection
 * that rides an export is gated on the claim its own routes ask for, read off
 * `ImportGrants`; and the three that never ride — audit, plugins, scope
 * renames — are refused outright, since an archive carrying them was not
 * written by silo's exporter.
 *
 * Judged on **rows**, not on schemas: every export carries the riding
 * collections' placeholder schemas even when they hold nothing, and a key that
 * may load a content collection must still be able to load an archive that
 * happens to describe an empty library.
 */
export class ImportSystemGate {
  private static readonly Rides: readonly string[] = [
    SystemCollections.Keys,
    SystemCollections.Media,
    SystemCollections.MediaFolders,
    SystemCollections.MediaFolderMoves,
    SystemCollections.Variables,
  ];

  private static readonly Catalog: readonly string[] = [
    SystemCollections.Media,
    SystemCollections.MediaFolders,
    SystemCollections.MediaFolderMoves,
  ];

  static async assert(parsed: ParsedImport, options: ImportOptions): Promise<void> {
    const grants = options.grants ?? ImportGrants.Trusted;
    for (const scoped of parsed.scopes) {
      if (!scoped.scope.isSystem()) continue;

      for (const name of new Set([...scoped.schemas.keys(), ...scoped.entries.keys()])) {
        if (ImportSystemGate.Rides.includes(name)) continue;
        throw new ValidationError(
          SystemCollections.isKnown(name)
            ? `this archive carries "_system/${name}", which is instance-local and never imports`
            : `this archive carries "_system/${name}", which is not a system collection silo knows`
        );
      }

      for (const [name, rows] of scoped.entries) {
        if (name === SystemCollections.Keys && !grants.keys) {
          throw new ForbiddenError(
            `import contains API keys but this key is missing claim "${Claims.KeysImport}"`
          );
        }
        if (ImportSystemGate.Catalog.includes(name)) {
          if (!grants.media) {
            throw new ForbiddenError(
              `import carries the media catalog ("${name}") but this key is missing claim "${Claims.MediaCreate}"`
            );
          }
          const empties =
            options.mode === "replace" &&
            ImportAuthority.replaces(scoped.scope, name, parsed.manifest, options);
          if (empties && !grants.mediaReplace) {
            throw new ForbiddenError(
              `a replace import would empty "${name}" but this key is missing claim "${Claims.MediaDelete}"`
            );
          }
        }
        if (name === SystemCollections.Variables) {
          await ImportSystemGate.assertVariables(rows, parsed, grants);
        }
      }
    }
  }

  /**
   * Variables are keyed by the archive's project ids, and the grant is by
   * name, so the archive's own project markers translate. A row naming a
   * project the archive does not carry is asked at `null`, which only an
   * instance-wide grant answers.
   */
  private static async assertVariables(
    rows: ImportEntries,
    parsed: ParsedImport,
    grants: ImportGrants
  ): Promise<void> {
    const names = new Map<string, string>();
    for (const project of parsed.projects ?? []) {
      if (project.id) names.set(project.id, project.name);
    }
    const asked = new Set<string>();
    for await (const row of rows) {
      const projectId = VariableRecords.from(row.data).project_id;
      if (asked.has(projectId)) continue;
      asked.add(projectId);
      const project = names.get(projectId) ?? null;
      if (grants.variables(project)) continue;
      const reach = `${project ?? "*"}/*/*`;
      throw new ForbiddenError(
        project === null
          ? `import declares variables for a project the archive does not name; loading them needs ` +
              `"${Claims.CollectionCreate}" and "${Claims.CollectionEntriesUpdate}" at ${reach}`
          : `import declares variables for project "${project}"; this key is missing ` +
              `"${Claims.CollectionCreate}" or "${Claims.CollectionEntriesUpdate}" at ${reach}`
      );
    }
  }
}
