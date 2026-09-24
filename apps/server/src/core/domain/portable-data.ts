import { ValidationError } from "@silo/shared/validation-error";

/**
 * Entry data every `Storage` adapter can hold (D92).
 *
 * Two kinds of string are refused, in keys and values alike: one holding a
 * NUL character (U+0000), and one that is not well-formed UTF-16 (a lone
 * surrogate). Postgres's `jsonb` stores neither, and a rule only one adapter
 * enforced would make the adapters disagree about what a write accepts.
 */
export class PortableData {
  static assert(data: unknown): void {
    PortableData.visit(data, "$");
  }

  /** The problem with one string, or null when it is portable. */
  static problem(text: string): string | null {
    if (text.includes("\0")) return "contains a NUL character (U+0000)";
    if (!text.isWellFormed()) return "contains an unpaired surrogate";
    return null;
  }

  private static visit(value: unknown, path: string): void {
    if (typeof value === "string") {
      PortableData.check(value, path);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => PortableData.visit(item, `${path}[${index}]`));
      return;
    }
    if (value === null || typeof value !== "object") return;

    for (const [key, item] of Object.entries(value)) {
      // Quoted unless plain, so the message never carries the character it names.
      const at = /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)
        ? `${path}.${key}`
        : `${path}[${JSON.stringify(key)}]`;
      PortableData.check(key, `${at} (the key)`);
      PortableData.visit(item, at);
    }
  }

  private static check(text: string, path: string): void {
    const problem = PortableData.problem(text);
    if (problem) throw new ValidationError(`entry data at ${path} ${problem}`);
  }
}
