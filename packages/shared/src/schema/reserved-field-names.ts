import { ValidationError } from "../errors/validation-error";

/**
 * The five field names an entry's data may not carry.
 *
 * The API answers an entry **flat** — the envelope's keys and the author's
 * fields in one object — so a collision there has no representation. A field
 * named `id` or `rev` would take the envelope's place and leave the entry
 * unaddressable; `created_at` and `updated_at` would be overwritten by it.
 * `seq` is never answered at all, but every first-party client destructures it
 * off as envelope, so a field by that name would vanish one layer further out.
 *
 * Enforced where data **enters**: a schema declaring one is refused by
 * `CollectionService.putSchema`, and an entry carrying one by
 * `SchemaValidator.validateEntry` — the choke point every write path and the
 * importer share. Silo used to delete these on the way out instead, which
 * stored a field it would never answer and told nobody (D62).
 */
export class ReservedFieldNames {
  static readonly All: readonly string[] = ["id", "rev", "seq", "created_at", "updated_at"];

  static is(name: string): boolean {
    return ReservedFieldNames.All.includes(name);
  }

  /**
   * The reserved names a schema declares as top-level properties. Nested
   * properties are not checked and must not be: only an entry's own top level
   * shares an object with the envelope, so `author.id` collides with nothing.
   */
  static declaredIn(schema: unknown): string[] {
    const properties = ReservedFieldNames.objectAt(schema, "properties");
    if (!properties) return [];
    return Object.keys(properties).filter((name) => ReservedFieldNames.is(name));
  }

  /** The reserved names present as top-level keys of an entry's data. */
  static presentIn(data: unknown): string[] {
    const fields = ReservedFieldNames.asObject(data);
    if (!fields) return [];
    return Object.keys(fields).filter((name) => ReservedFieldNames.is(name));
  }

  /** Refuses a schema that declares one, naming every offender at once. */
  static assertNoneDeclared(schema: unknown, collection: string): void {
    const found = ReservedFieldNames.declaredIn(schema);
    if (found.length === 0) return;
    throw new ValidationError(
      `collection "${collection}" declares reserved field ${ReservedFieldNames.list(found)}: ` +
        `${ReservedFieldNames.list(ReservedFieldNames.All)} belong to the silo and ` +
        `cannot be used as field names`,
      found.map((name) => ({ path: `/properties/${name}`, message: "reserved field name" }))
    );
  }

  /** Refuses entry data carrying one, whatever the schema happens to allow. */
  static assertNonePresent(data: unknown): void {
    const found = ReservedFieldNames.presentIn(data);
    if (found.length === 0) return;
    throw new ValidationError(
      `entry carries reserved field ${ReservedFieldNames.list(found)}: ` +
        `${ReservedFieldNames.list(ReservedFieldNames.All)} belong to the silo and ` +
        `cannot be used as field names`,
      found.map((name) => ({ path: `/${name}`, message: "reserved field name" }))
    );
  }

  private static list(names: readonly string[]): string {
    return names.map((name) => `"${name}"`).join(", ");
  }

  private static objectAt(value: unknown, key: string): Record<string, unknown> | null {
    const object = ReservedFieldNames.asObject(value);
    if (!object) return null;
    return ReservedFieldNames.asObject(object[key]);
  }

  private static asObject(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  }
}
