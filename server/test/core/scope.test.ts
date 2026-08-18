import { describe, test, expect } from "bun:test";
import { Scope } from "../../core/domain/scope";
import { ValidationError } from "@silo/shared/validation-error";

describe("Scope", () => {
  test("accepts valid ids", () => {
    const s = Scope.of("acme", "prod");
    expect(s.project).toBe("acme");
    expect(s.env).toBe("prod");

    expect(() => Scope.of("a", "b")).not.toThrow();
    expect(() => Scope.of("a1-2_3", "env-1")).not.toThrow();
    expect(() => Scope.of("a".repeat(64), "prod")).not.toThrow();
  });

  test("rejects invalid ids", () => {
    expect(() => Scope.of("", "prod")).toThrow(ValidationError);
    expect(() => Scope.of("Acme", "prod")).toThrow(ValidationError);
    expect(() => Scope.of("1acme", "prod")).toThrow(ValidationError);
    expect(() => Scope.of("acme!", "prod")).toThrow(ValidationError);
    expect(() => Scope.of("acme prod", "prod")).toThrow(ValidationError);
    expect(() => Scope.of("acme", "")).toThrow(ValidationError);
    expect(() => Scope.of("acme", "Prod")).toThrow(ValidationError);
  });

  test("rejects ids too long", () => {
    expect(() => Scope.of("a".repeat(65), "prod")).toThrow(ValidationError);
    expect(() => Scope.of("acme", "e".repeat(65))).toThrow(ValidationError);
  });

  test("rejects reserved underscore-prefixed ids via public construction", () => {
    expect(() => Scope.of("_system", "prod")).toThrow(ValidationError);
    expect(() => Scope.of("acme", "_system")).toThrow(ValidationError);
    expect(() => Scope.of("_reserved", "_reserved")).toThrow(ValidationError);
  });

  test("key() renders project/env", () => {
    expect(Scope.of("acme", "prod").key()).toBe("acme/prod");
    expect(Scope.System.key()).toBe("_system/_system");
    expect(Scope.Default.key()).toBe("default/prod");
  });

  test("equals() compares by value", () => {
    const a = Scope.of("acme", "prod");
    const b = Scope.of("acme", "prod");
    const c = Scope.of("acme", "dev");
    expect(a.equals(b)).toBe(true);
    expect(a.equals(c)).toBe(false);
    expect(a).not.toBe(b);
  });

  test("System and Default are stable, distinguishable identities", () => {
    expect(Scope.System.project).toBe("_system");
    expect(Scope.System.env).toBe("_system");
    expect(Scope.System.isSystem()).toBe(true);

    expect(Scope.Default.project).toBe("default");
    expect(Scope.Default.env).toBe("prod");
    expect(Scope.Default.isSystem()).toBe(false);

    expect(Scope.System.equals(Scope.Default)).toBe(false);
    expect(Scope.System).toBe(Scope.System);
    expect(Scope.Default).toBe(Scope.Default);
  });

  test("isSystem() is true only for the reserved system scope", () => {
    expect(Scope.of("acme", "prod").isSystem()).toBe(false);
    // A project/env that merely spells "system" (no underscore) is an
    // ordinary, unrelated scope.
    expect(Scope.of("system", "system").isSystem()).toBe(false);
  });
});
