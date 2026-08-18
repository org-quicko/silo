import { describe, expect, test } from "bun:test";
import { ValidationError } from "../src/errors/validation-error";

/**
 * Stands in for a second copy of `validation-error.ts` loaded under a separate
 * module identity — what a `file:`-copied dependency, a `dist/` build sitting
 * next to `src/`, or a bundler with different export conditions would produce.
 * The brand literal is repeated rather than read off `ValidationError` because
 * the real duplicate would carry its own compiled copy of the same source text.
 */
class DuplicateValidationError extends Error {
  readonly brand = "silo.ValidationError";
  details: { path: string; message: string }[] = [];
}

describe("validation error", () => {
  test("recognizes its own instances", () => {
    const err = new ValidationError("bad input", [{ path: "/title", message: "required" }]);
    expect(ValidationError.is(err)).toBe(true);
    expect(err.message).toBe('bad input: "/title": required');
    expect(err.details).toHaveLength(1);
  });

  test("recognizes an instance from a duplicate copy of this module", () => {
    const duplicate = new DuplicateValidationError();
    // The hazard the brand exists for: prototype identity says no...
    expect(duplicate instanceof ValidationError).toBe(false);
    // ...while the brand still identifies it, so no catch site downgrades a 400.
    expect(ValidationError.is(duplicate)).toBe(true);
  });

  test("rejects anything else", () => {
    expect(ValidationError.is(new Error("boom"))).toBe(false);
    expect(ValidationError.is(new TypeError("boom"))).toBe(false);
    // A branded non-Error is not one of ours: `is()` narrows to an Error type.
    expect(ValidationError.is({ brand: ValidationError.Brand })).toBe(false);
    expect(ValidationError.is(ValidationError.Brand)).toBe(false);
    expect(ValidationError.is(null)).toBe(false);
    expect(ValidationError.is(undefined)).toBe(false);
  });
});
