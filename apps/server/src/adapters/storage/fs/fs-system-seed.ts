import path from "path";
import { Scope } from "../../../core/domain/scope";
import { SystemCollections } from "../../../core/domain/system-collections";
import { FsFiles } from "./fs-files";
import { FsLayout } from "./fs-layout";
import { FsMarker } from "./fs-marker";

/**
 * The reserved scope and its collections, as records on disk (D51) — the fs
 * counterpart of `SqliteMigrations.seedSystemRecords`.
 *
 * It exists so the two adapters answer `listCollections(Scope.System)` the same
 * way. Seeding SQLite alone would have left the fs adapter reporting no records
 * for collections it happily holds entries for, which is exactly the kind of
 * divergence the conformance suite is for.
 *
 * Ids are the reserved names rather than minted ULIDs, so `_keys` addresses
 * identically on every instance. That is also why the create paths refuse a
 * supplied `_`-prefixed id: nothing then has to scan the reserved scope for
 * collisions.
 */
export class FsSystemSeed {
  static async apply(layout: FsLayout): Promise<void> {
    const scope = Scope.System;

    // Each marker write creates its own directory, so there is nothing to
    // mkdir first.
    await FsMarker.write(
      path.join(layout.projectDir(scope.project), FsLayout.ProjectMarker),
      scope.project
    );
    await FsMarker.write(
      path.join(layout.envDir(scope.project, scope.env), FsLayout.EnvMarker),
      scope.env
    );

    const schema = JSON.stringify(SystemCollections.Schema, null, 2);
    for (const name of SystemCollections.All) {
      const schemaFile = layout.schemaFile(scope, name);
      if (!(await FsFiles.exists(schemaFile))) {
        await FsFiles.writeAtomic(schemaFile, schema);
      }
      await FsMarker.write(layout.collectionMarkerFile(scope, name), name);
    }
  }
}
