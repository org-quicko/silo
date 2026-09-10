import { describe, expect, test } from "bun:test";
import { ConflictError } from "../../src/errors/conflict-error";
import { ErrorFactory } from "../../src/errors/error-factory";
import { ForbiddenError } from "../../src/errors/forbidden-error";
import { InternalError } from "../../src/errors/internal-error";
import { MediaDeleteStalledError } from "../../src/errors/media-delete-stalled-error";
import { MediaInUseError } from "../../src/errors/media-in-use-error";
import { NotFoundError } from "../../src/errors/not-found-error";
import { SiloError } from "../../src/errors/silo-error";
import { UnauthorizedError } from "../../src/errors/unauthorized-error";
import { ValidationFailedError } from "../../src/errors/validation-failed-error";

const body = (payload: unknown): string => JSON.stringify(payload);

describe("ErrorFactory: one class per wire code", () => {
  test("validation_failed, with its details array", () => {
    const error = ErrorFactory.fromResponseBody(
      400,
      "POST",
      "/api/projects",
      body({ error: { code: "validation_failed", message: "bad", details: [{ path: "/id", message: "required" }] } }),
    );
    expect(error).toBeInstanceOf(ValidationFailedError);
    expect((error as ValidationFailedError).details).toEqual([{ path: "/id", message: "required" }]);
  });

  test("unauthorized", () => {
    const error = ErrorFactory.fromResponseBody(401, "GET", "/api/projects", body({ error: { code: "unauthorized", message: "no key" } }));
    expect(error).toBeInstanceOf(UnauthorizedError);
  });

  test("forbidden", () => {
    const error = ErrorFactory.fromResponseBody(403, "GET", "/api/projects", body({ error: { code: "forbidden", message: "no claim" } }));
    expect(error).toBeInstanceOf(ForbiddenError);
  });

  test("not_found", () => {
    const error = ErrorFactory.fromResponseBody(404, "GET", "/api/projects/acme", body({ error: { code: "not_found", message: "gone" } }));
    expect(error).toBeInstanceOf(NotFoundError);
  });

  test("conflict", () => {
    const error = ErrorFactory.fromResponseBody(409, "PUT", "/api/.../posts/01J8", body({ error: { code: "conflict", message: "stale rev" } }));
    expect(error).toBeInstanceOf(ConflictError);
  });

  test("media_in_use, with its OBJECT-shaped details", () => {
    const error = ErrorFactory.fromResponseBody(
      409,
      "DELETE",
      "/api/media/01J8",
      body({
        error: {
          code: "media_in_use",
          message: "in use",
          details: { usage_count: 2, visible_count: 1, visible_capped: false, referrers: [] },
        },
      }),
    );
    expect(error).toBeInstanceOf(MediaInUseError);
    expect((error as MediaInUseError).usageCount).toBe(2);
  });

  test("media_delete_stalled", () => {
    const error = ErrorFactory.fromResponseBody(
      500,
      "DELETE",
      "/api/media/01J8",
      body({ error: { code: "media_delete_stalled", message: "stalled", details: { remedy: "silo media reconcile" } } }),
    );
    expect(error).toBeInstanceOf(MediaDeleteStalledError);
    expect((error as MediaDeleteStalledError).remedy).toBe("silo media reconcile");
  });

  test("internal", () => {
    const error = ErrorFactory.fromResponseBody(500, "GET", "/api/health", body({ error: { code: "internal", message: "bug" } }));
    expect(error).toBeInstanceOf(InternalError);
  });
});

describe("ErrorFactory: fallbacks", () => {
  test("an unrecognised code falls back to its HTTP status", () => {
    const error = ErrorFactory.fromResponseBody(404, "GET", "/api/x", body({ error: { code: "something_new", message: "?" } }));
    expect(error).toBeInstanceOf(NotFoundError);
  });

  test("an unrecognised status falls back to SiloError itself", () => {
    const error = ErrorFactory.fromResponseBody(418, "GET", "/api/x", body({ error: { code: "teapot", message: "no coffee" } }));
    expect(error).toBeInstanceOf(SiloError);
    expect(error).not.toBeInstanceOf(NotFoundError);
    expect(error.status).toBe(418);
    expect(error.code).toBe("unknown");
  });

  test("survives a body that is not JSON at all, such as a proxy's HTML error page", () => {
    const error = ErrorFactory.fromResponseBody(502, "GET", "/api/health", "<html><body>Bad Gateway</body></html>");
    expect(error).toBeInstanceOf(SiloError);
    expect(error.status).toBe(502);
    expect(error.message).toContain("Bad Gateway");
  });

  test("survives an empty body, falling back to SiloError since 500 names no class of its own by status alone", () => {
    const error = ErrorFactory.fromResponseBody(500, "GET", "/api/health", "");
    expect(error).toBeInstanceOf(SiloError);
    expect(error.status).toBe(500);
    expect(error.message).toContain("500");
  });
});
