/**
 * An environment as a keyed record (D51).
 *
 * `name` is unique within `project_id` rather than across the instance, so two
 * projects may each hold a `prod`. The parent is held by id, so renaming the
 * project moves nothing here.
 */
export interface EnvironmentRecord {
  id: string;
  project_id: string;
  name: string;
  created_at: Date;
  updated_at: Date;
}
