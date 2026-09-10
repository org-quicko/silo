import { describe, expect, test } from "bun:test";
import { ConflictError } from "../../src/errors/conflict-error";
import { ForbiddenError } from "../../src/errors/forbidden-error";
import { InternalError } from "../../src/errors/internal-error";
import { NotFoundError } from "../../src/errors/not-found-error";
import { SiloError } from "../../src/errors/silo-error";
import { UnauthorizedError } from "../../src/errors/unauthorized-error";
import { ValidationFailedError } from "../../src/errors/validation-failed-error";

describe("SiloError", () => {
  test("carries status, code, message, method and path", () => {
    const error = new SiloError(500, "internal", "boom", "GET", "/api/health");
    expect(error.status).toBe(500);
    expect(error.code).toBe("internal");
    expect(error.message).toBe("boom");
    expect(error.method).toBe("GET");
    expect(error.path).toBe("/api/health");
    expect(error.name).toBe("SiloError");
    expect(error).toBeInstanceOf(Error);
  });
});

describe("SiloError subclasses", () => {
  test("each is a SiloError with its own status and code", () => {
    const cases: Array<[SiloError, number, string, string]> = [
      [new ValidationFailedError("bad", "POST", "/api/projects", []), 400, "validation_failed", "ValidationFailedError"],
      [new UnauthorizedError("no key", "GET", "/api/projects"), 401, "unauthorized", "UnauthorizedError"],
      [new ForbiddenError("no claim", "GET", "/api/projects"), 403, "forbidden", "ForbiddenError"],
      [new NotFoundError("gone", "GET", "/api/projects/acme"), 404, "not_found", "NotFoundError"],
      [new ConflictError("stale rev", "PUT", "/api/.../posts/01J8"), 409, "conflict", "ConflictError"],
      [new InternalError("bug", "GET", "/api/health"), 500, "internal", "InternalError"],
    ];

    for (const [error, status, code, name] of cases) {
      expect(error).toBeInstanceOf(SiloError);
      expect(error).toBeInstanceOf(Error);
      expect(error.status).toBe(status);
      expect(error.code).toBe(code);
      expect(error.name).toBe(name);
    }
  });

  test("ConflictError accepts a more specific code for a subclass to pass", () => {
    const error = new ConflictError("in use", "DELETE", "/api/media/01J8", "media_in_use");
    expect(error.code).toBe("media_in_use");
  });
});

describe("ValidationFailedError.fromWireDetails", () => {
  test("keeps the details array from the wire", () => {
    const details = [{ path: "/title", message: "required" }];
    const error = ValidationFailedError.fromWireDetails("invalid", "POST", "/api/x", details);
    expect(error.details).toEqual(details);
  });

  test("falls back to an empty array when details is not an array", () => {
    const error = ValidationFailedError.fromWireDetails("invalid", "POST", "/api/x", { not: "an array" });
    expect(error.details).toEqual([]);
  });
});
