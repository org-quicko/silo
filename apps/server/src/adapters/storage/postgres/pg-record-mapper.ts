import type { CollectionRecord } from "../../../core/domain/collection-record";
import type { EnvironmentRecord } from "../../../core/domain/environment-record";
import type { ProjectRecord } from "../../../core/domain/project-record";
import { NotFoundError } from "../../../core/errors/not-found-error";

/** Rows of the three record tables, as their domain shapes (D51). */
export class PgRecordMapper {
  static readonly ProjectColumns = "id, name, created_at, updated_at";
  static readonly EnvironmentColumns = "id, project_id, name, created_at, updated_at";
  static readonly CollectionColumns =
    "id, project_id, env_id, name, schema, created_at, updated_at";

  static toProject(row: any): ProjectRecord {
    return {
      id: row.id,
      name: row.name,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
    };
  }

  static toEnvironment(row: any): EnvironmentRecord {
    return {
      id: row.id,
      project_id: row.project_id,
      name: row.name,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
    };
  }

  /** `schema` is text, parsed here, so it comes back exactly as it was written. */
  static toCollection(row: any): CollectionRecord {
    return {
      id: row.id,
      project_id: row.project_id,
      env_id: row.env_id,
      name: row.name,
      schema: JSON.parse(row.schema),
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
    };
  }

  /** A rename addressed an id nothing holds; named by id, as `SqliteRecordMapper` explains. */
  static noSuchRecord(label: string, id: string): NotFoundError {
    return new NotFoundError(`no ${label} with id "${id}"`);
  }
}
