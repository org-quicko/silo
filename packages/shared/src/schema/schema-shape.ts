/**
 * A schema document reduced to the part that decides whether an entry is valid
 * (D69).
 *
 * A collection's schema carries two kinds of keyword. Most of it says what a
 * valid entry looks like. The rest — `x-silo-auth`, `x-silo-search`, and JSON
 * Schema's own annotations — configures silo or labels the form, and changing
 * it cannot make a stored entry stop validating.
 *
 * Only the first kind is frozen once a collection holds entries, because only
 * the first kind can invalidate what is already stored. Making a populated
 * collection public, correcting a search path or fixing a field's label stays
 * an ordinary edit; without that split the only way to publish a collection
 * would be to empty it first.
 *
 * The list is **closed**, not "annotations we could think of". A keyword left
 * off it is frozen, which is the safe direction: the worst case is an edit
 * refused that need not have been, and the author is told which collection and
 * how many entries stand in the way. The opposite default would let a keyword
 * nobody classified change what validates, under a collection the operator
 * believes is frozen.
 */
export class SchemaShape {
  /**
   * The keywords stripped before comparing.
   *
   * `x-silo-auth` gates reads and `x-silo-search` selects what reaches the
   * index — both are silo configuration that Ajv never sees. `title`,
   * `description` and `$comment` are JSON Schema annotations: the spec assigns
   * them no assertion behaviour at all.
   *
   * `$schema` is here for a reason particular to silo: `SchemaValidator`
   * compiles every collection with `Ajv2020` and nothing else, so the keyword
   * records which dialect the author had in mind rather than selecting one.
   * It cannot change what validates, and a value Ajv will not accept is a
   * `400` from `checkSchemaDoc` before this is consulted. It earns its place
   * because the admin's visual builder writes `$schema` on every save, so
   * without it the first save of a schema created without one — over the API,
   * or by an importer — would be refused for a keyword the author never typed.
   *
   * `default` is deliberately **not** here. It annotates in the spec, but the
   * admin's form seeds a new entry from it, so changing it changes what gets
   * written — and `examples` is not here because it is not worth a special
   * case when it costs nothing to freeze.
   */
  static readonly Annotations: readonly string[] = [
    "x-silo-auth",
    "x-silo-search",
    "title",
    "description",
    "$comment",
    "$schema",
  ];

  /**
   * Keywords whose values are **data**, not subschemas.
   *
   * A walk that recursed into these would strip a key genuinely named `title`
   * out of an `enum` member or a `default` object, and two schemas differing
   * only there would compare equal. `SchemaBundler.collectRefs` stops at the
   * same four for the same reason.
   */
  private static readonly Literals: readonly string[] = ["enum", "const", "default", "examples"];

  /**
   * Keywords whose **keys are names the author chose**, not keywords.
   *
   * This is the distinction that makes the walk safe. `title` under
   * `properties` is a field called "title"; `title` anywhere a keyword is
   * expected is a label. Stripping without the difference would drop a field
   * named `title`, `description` or `$comment` out of the comparison — and a
   * field silently outside the frozen shape is a field that could be retyped
   * or removed under a collection that already holds entries.
   *
   * `dependentRequired` is here although its values are string arrays rather
   * than schemas: its keys are property names too, which is the only thing
   * this list is about.
   */
  private static readonly Named: readonly string[] = [
    "properties",
    "patternProperties",
    "dependentSchemas",
    "dependentRequired",
    "$defs",
    "definitions",
  ];

  /** Whether two schema documents impose the same constraints on an entry. */
  static same(left: unknown, right: unknown): boolean {
    return SchemaShape.canonical(SchemaShape.of(left)) === SchemaShape.canonical(SchemaShape.of(right));
  }

  /**
   * The document with every annotation removed, at every depth.
   *
   * Everything that is not a literal or a named map is walked as a schema, so
   * `allOf`, `items`, `if`/`then` and any composition keyword are covered
   * without enumerating them. The cost of that generality is that an unknown
   * keyword holding a plain object has its `title` stripped as if it were one;
   * the benefit is that no composition keyword can be forgotten, which is the
   * failure that would matter.
   */
  static of(schema: unknown): unknown {
    if (Array.isArray(schema)) {
      return schema.map((item) => SchemaShape.of(item));
    }
    if (!schema || typeof schema !== "object") return schema;

    const stripped: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
      if (SchemaShape.Annotations.includes(key)) continue;
      if (SchemaShape.Literals.includes(key)) stripped[key] = value;
      else if (SchemaShape.Named.includes(key)) stripped[key] = SchemaShape.ofNamed(value);
      else if (key === "required") stripped[key] = SchemaShape.asSet(value);
      else stripped[key] = SchemaShape.of(value);
    }
    return stripped;
  }

  /**
   * `required` sorted, because it is a set and not a sequence.
   *
   * The admin's visual builder writes it in field order, so dragging a row to
   * reorder the form rewrites the array without changing a single constraint —
   * and that would otherwise be refused on a populated collection as if a field
   * had been retyped.
   */
  private static asSet(value: unknown): unknown {
    if (!Array.isArray(value)) return SchemaShape.of(value);
    return [...value].sort((left, right) =>
      String(left) < String(right) ? -1 : String(left) > String(right) ? 1 : 0
    );
  }

  /** A map keyed by author-chosen names: the keys survive, the values are
   *  walked as schemas. */
  private static ofNamed(node: unknown): unknown {
    if (!node || typeof node !== "object" || Array.isArray(node)) return node;

    const walked: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(node as Record<string, unknown>)) {
      walked[name] = SchemaShape.of(value);
    }
    return walked;
  }

  /**
   * JSON with object keys sorted, so a re-save that reorders them is not read
   * as a change. The admin round-trips the document through a text editor and
   * `JSON.parse`, both of which preserve insertion order rather than any order
   * the server chose, so an unsorted `JSON.stringify` would report an edit that
   * nobody made.
   */
  private static canonical(node: unknown): string {
    if (Array.isArray(node)) {
      return `[${node.map((item) => SchemaShape.canonical(item)).join(",")}]`;
    }
    if (!node || typeof node !== "object") return JSON.stringify(node) ?? "null";

    const entries = Object.entries(node as Record<string, unknown>)
      .filter(([, value]) => value !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, value]) => `${JSON.stringify(key)}:${SchemaShape.canonical(value)}`);
    return `{${entries.join(",")}}`;
  }
}
