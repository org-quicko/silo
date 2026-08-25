import { ValidationError } from "../../errors/validation-error";
import type { PathSelector } from "./path-selector";

/**
 * An RFC 9535 JSONPath, restricted to the subset silo accepts (D29), parsed
 * once into selectors that every consumer reads: the admin UI's filter
 * builder, `QueryUtils` validation, the SQLite compiler and the in-memory
 * evaluator. It lives in `@silo/shared` for the reason §4 gives — a protocol
 * rule with two implementations is a rule that will drift.
 *
 * The root is the **virtual entry document**, `{ id, rev, created_at,
 * updated_at, data }`. Its envelope half is exactly what
 * `EntryUtils.toApiResponse` exposes; user fields live under `$.data` rather
 * than flattened as the wire response has them, so a user field named `id`
 * cannot shadow the envelope's. `project`, `env`, `collection` and `seq` are
 * absent because the API hides them — unaddressable by derivation, not by a
 * second list that would drift from the first.
 *
 * Everything outside the subset is **refused by name**, never ignored. A
 * dropped selector does not fail; it silently answers a different question,
 * and no test written with well-formed paths would ever catch it.
 */
export class JsonPath {
  /** The envelope fields a path may address, and the gateway to user data. */
  static readonly EnvelopeFields = ["id", "rev", "created_at", "updated_at"] as const;
  static readonly DataField = "data";

  readonly raw: string;
  /** `"data"` or one of {@link JsonPath.EnvelopeFields}. */
  readonly root: string;
  /** Selectors *after* the root. Always empty for an envelope path. */
  readonly selectors: readonly PathSelector[];

  private constructor(raw: string, root: string, selectors: PathSelector[]) {
    this.raw = raw;
    this.root = root;
    this.selectors = selectors;
  }

  /** True when the path can select at most one node — no wildcard anywhere. */
  get singular(): boolean {
    return !this.selectors.some((s) => s.kind === "wildcard");
  }

  /** True for `$.id`, `$.rev`, `$.created_at`, `$.updated_at`. */
  get isEnvelope(): boolean {
    return this.root !== JsonPath.DataField;
  }

  /** `$.id` — and the three below. Spelled once so no caller invents them. */
  static readonly Id = "$.id";
  static readonly Rev = "$.rev";
  static readonly CreatedAt = "$.created_at";
  static readonly UpdatedAt = "$.updated_at";

  /**
   * A path to one top-level user field. Field names come from schemas and from
   * column headers, so they are not all shorthand-safe — this quotes the ones
   * that need it instead of leaving each caller to build a string that mostly
   * works.
   */
  static dataField(name: string): string {
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return `$.${JsonPath.DataField}.${name}`;
    return `$.${JsonPath.DataField}['${name.replace(/(['\\])/g, "\\$1")}']`;
  }

  static isValid(raw: string): boolean {
    try {
      JsonPath.parse(raw);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Parsed paths are immutable and re-parsed constantly — the fs adapter
   * evaluates a filter once per entry, so an uncached parse would repeat for
   * every row of every scan. The cap keeps a stream of distinct paths from
   * growing this without bound; paths are cheap to re-parse, so dropping the
   * whole map is a better trade than tracking recency.
   */
  private static readonly cache = new Map<string, JsonPath>();
  private static readonly CacheLimit = 512;

  static parse(raw: string): JsonPath {
    const hit = JsonPath.cache.get(raw);
    if (hit) return hit;
    const parsed = JsonPath.parseUncached(raw);
    if (JsonPath.cache.size >= JsonPath.CacheLimit) JsonPath.cache.clear();
    JsonPath.cache.set(raw, parsed);
    return parsed;
  }

  private static parseUncached(raw: string): JsonPath {
    if (typeof raw !== "string" || raw.length === 0) {
      throw JsonPath.invalid(String(raw), "a path is required");
    }
    if (raw[0] !== "$") {
      throw JsonPath.invalid(raw, 'a path must start at the root, "$"');
    }

    const selectors: PathSelector[] = [];
    let i = 1;

    while (i < raw.length) {
      const c = raw[i];

      if (c === ".") {
        if (raw[i + 1] === ".") {
          throw JsonPath.unsupported(raw, "recursive-descent selectors (`..`)");
        }
        if (raw[i + 1] === "*") {
          selectors.push({ kind: "wildcard" });
          i += 2;
          continue;
        }
        const start = i + 1;
        let j = start;
        while (j < raw.length && JsonPath.isNameChar(raw[j], j === start)) j++;
        if (j === start) {
          throw JsonPath.invalid(raw, `expected a field name after "." at position ${i}`);
        }
        // `length()`, `count()` and friends are function extensions, which the
        // subset excludes. Naming them beats "unexpected character '('".
        if (raw[j] === "(") {
          throw JsonPath.unsupported(raw, `function extensions (\`${raw.slice(start, j)}()\`)`);
        }
        selectors.push({ kind: "name", name: raw.slice(start, j) });
        i = j;
        continue;
      }

      if (c === "[") {
        const close = raw.indexOf("]", i + 1);
        if (close === -1) {
          throw JsonPath.invalid(raw, `unclosed "[" at position ${i}`);
        }
        const inner = raw.slice(i + 1, close);
        selectors.push(JsonPath.bracketSelector(raw, inner));
        i = close + 1;
        continue;
      }

      throw JsonPath.invalid(raw, `unexpected "${c}" at position ${i}`);
    }

    if (selectors.length === 0) {
      throw JsonPath.invalid(raw, "a path must address a field, not the whole entry");
    }

    const first = selectors[0];
    if (first.kind !== "name") {
      throw JsonPath.invalid(raw, "a path must start with a field name");
    }

    const root = first.name;
    const rest = selectors.slice(1);

    if (root === JsonPath.DataField) {
      return new JsonPath(raw, root, rest);
    }
    if ((JsonPath.EnvelopeFields as readonly string[]).includes(root)) {
      // An envelope field is a scalar. `$.id[0]` is a mistake worth naming, not
      // a path that quietly selects nothing.
      if (rest.length > 0) {
        throw JsonPath.invalid(raw, `"$.${root}" is a scalar and takes no further selectors`);
      }
      return new JsonPath(raw, root, []);
    }

    const addressable = [...JsonPath.EnvelopeFields, JsonPath.DataField]
      .map((f) => `$.${f}`)
      .join(", ");
    // `project`/`env`/`collection`/`seq` land here. They are not secret, they
    // are simply not part of the document a caller can see (§5.1), and saying
    // so is more useful than "unknown field".
    throw JsonPath.invalid(
      raw,
      `"$.${root}" is not part of the entry document; address one of ${addressable}`
    );
  }

  private static bracketSelector(raw: string, inner: string): PathSelector {
    if (inner === "*") return { kind: "wildcard" };

    if (inner.includes(":")) {
      throw JsonPath.unsupported(raw, "slice selectors (`[start:end]`)");
    }
    if (inner.includes(",")) {
      throw JsonPath.unsupported(raw, "index-union selectors (`[0,2]`)");
    }
    if (inner.startsWith("?")) {
      throw JsonPath.unsupported(raw, "filter selectors (`[?...]`)");
    }

    const quote = inner[0];
    if (quote === "'" || quote === '"') {
      if (inner.length < 2 || inner[inner.length - 1] !== quote) {
        throw JsonPath.invalid(raw, `unterminated quoted name ${inner}`);
      }
      return { kind: "name", name: JsonPath.unescape(inner.slice(1, -1)) };
    }

    if (!/^-?\d+$/.test(inner)) {
      throw JsonPath.invalid(raw, `"[${inner}]" is not an index, a quoted name, or "*"`);
    }
    return { kind: "index", index: Number.parseInt(inner, 10) };
  }

  private static unescape(s: string): string {
    return s.replace(/\\(.)/g, "$1");
  }

  /**
   * RFC 9535 member-name-shorthand: an ASCII letter, `_`, or any character at
   * or above U+0080 to start; digits allowed after. A quoted bracket name
   * carries anything else.
   */
  private static isNameChar(c: string, first: boolean): boolean {
    if (c.charCodeAt(0) >= 0x80) return true;
    if (c === "_") return true;
    if ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z")) return true;
    return !first && c >= "0" && c <= "9";
  }

  private static unsupported(raw: string, what: string): ValidationError {
    return JsonPath.invalid(raw, `${what} are not supported`);
  }

  private static invalid(raw: string, reason: string): ValidationError {
    return new ValidationError(`invalid path "${raw}": ${reason}`);
  }
}
