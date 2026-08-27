import fs from "fs/promises";
import path from "path";
import type { Scope } from "../../../core/domain/scope";
import { NotFoundError } from "../../../core/errors/not-found-error";
import { FsFiles } from "./fs-files";
import { FsLayout } from "./fs-layout";

/** Collection schemas, one `<collection>.schema.json` per collection. */
export class FsSchemaStore {
  private readonly layout: FsLayout;

  constructor(layout: FsLayout) {
    this.layout = layout;
  }

  async put(scope: Scope, collection: string, schema: any): Promise<void> {
    await FsFiles.writeAtomic(
      this.layout.schemaFile(scope, collection),
      JSON.stringify(schema, null, 2)
    );
  }

  async get(scope: Scope, collection: string): Promise<any> {
    try {
      return JSON.parse(await fs.readFile(this.layout.schemaFile(scope, collection), "utf8"));
    } catch (error: any) {
      if (error.code === "ENOENT") throw FsSchemaStore.notFound(scope, collection);
      throw error;
    }
  }

  async list(scope: Scope): Promise<Map<string, any>> {
    const schemasDir = this.layout.schemasDir(scope);
    const schemas = new Map<string, any>();

    for (const entry of await FsFiles.readDirents(schemasDir)) {
      if (entry.name.startsWith(".")) continue;

      const collection = FsLayout.collectionOfSchemaFile(entry.name);
      if (collection === null) continue;

      const raw = await fs.readFile(path.join(schemasDir, entry.name), "utf8");
      schemas.set(collection, JSON.parse(raw));
    }
    return schemas;
  }

  async delete(scope: Scope, collection: string): Promise<void> {
    try {
      await fs.unlink(this.layout.schemaFile(scope, collection));
    } catch (error: any) {
      if (error.code === "ENOENT") throw FsSchemaStore.notFound(scope, collection);
      throw error;
    }
  }

  private static notFound(scope: Scope, collection: string): NotFoundError {
    return new NotFoundError(`collection "${scope.key()}/${collection}" not found`);
  }
}
