import { VariableName } from "./variable-name";

/** One `{{NAME}}` occurrence found in a string. */
export interface VariableReference {
  name: string;
  /** Index of the opening `{` in the source string. */
  start: number;
  /** Index one past the closing `}`. */
  end: number;
}

/**
 * The `{{NAME}}` grammar: the one place it is parsed (D57).
 *
 * There is exactly one parser, shared by the server that substitutes and the
 * admin that previews, for the reason `ClaimGrammar` states about itself — a
 * second would be a second answer to "what does this text reference?", and the
 * failure would be an editor showing a value the API never fills in.
 *
 * Three rules keep it boring:
 *
 * - **Only a well-formed name matches.** `{{ }}`, `{{a b}}` and `{{9x}}` are
 *   ordinary text. Optional inner whitespace (`{{ API_URL }}`) is trimmed,
 *   because a person typing it will put it there.
 * - **An unknown name is left alone.** Substitution replaces the references it
 *   has values for and copies the rest through verbatim, so content that
 *   happens to contain `{{handlebars}}` survives silo untouched unless someone
 *   has declared a variable by that name. Visible beats silent, the same
 *   asymmetry `MediaRefs` takes.
 * - **The result is never re-scanned.** A value that itself contains `{{X}}`
 *   is inserted as text and stays text, so no value can expand into another
 *   and no pair of values can loop.
 */
export class VariableTemplate {
  /**
   * `g` so `exec` walks a string. Reset before every use rather than trusted:
   * `lastIndex` survives on a shared instance, and a stale one silently skips
   * the first reference of the next string.
   */
  private static readonly Pattern = /\{\{\s*([A-Za-z_][A-Za-z0-9_]{0,63})\s*\}\}/g;

  /** Whether `text` references anything at all. Cheap enough to gate a walk. */
  static has(text: string): boolean {
    if (typeof text !== "string" || !text.includes("{{")) return false;
    VariableTemplate.Pattern.lastIndex = 0;
    return VariableTemplate.Pattern.test(text);
  }

  /** Every reference in `text`, in the order they appear, duplicates kept. */
  static references(text: string): VariableReference[] {
    const found: VariableReference[] = [];
    if (typeof text !== "string" || !text.includes("{{")) return found;

    VariableTemplate.Pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = VariableTemplate.Pattern.exec(text)) !== null) {
      found.push({ name: match[1]!, start: match.index, end: match.index + match[0].length });
    }
    return found;
  }

  /** The distinct names `text` references. */
  static names(text: string): string[] {
    return [...new Set(VariableTemplate.references(text).map((reference) => reference.name))];
  }

  /**
   * `text` with every reference `lookup` can answer replaced by its value.
   *
   * `lookup` returning `undefined` means "not declared here", and that
   * reference is copied through unchanged — the caller cannot tell the two
   * apart from the result, which is the point: an unresolved template is
   * meant to still read as one.
   */
  static render(text: string, lookup: (name: string) => string | undefined): string {
    if (!VariableTemplate.has(text)) return text;

    VariableTemplate.Pattern.lastIndex = 0;
    return text.replace(VariableTemplate.Pattern, (whole, name: string) => {
      const value = lookup(name);
      return value === undefined ? whole : value;
    });
  }

  /** How a reference is spelled. The one place the braces are written. */
  static spell(name: string): string {
    return `{{${name}}}`;
  }

  /** Re-exported so a caller validating a typed name imports one module. */
  static isValidName(name: unknown): name is string {
    return VariableName.isValid(name);
  }
}
