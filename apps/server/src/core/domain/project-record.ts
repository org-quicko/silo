/**
 * A project as a keyed record (D51).
 *
 * `id` is a ULID and never changes; `name` is a mutable label, unique across
 * the instance, and is what every route path, claim string and archive
 * directory addresses. Nothing else references the name, which is what makes a
 * rename one row update.
 */
export interface ProjectRecord {
  id: string;
  name: string;
  created_at: Date;
  updated_at: Date;
}
