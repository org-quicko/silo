import { describe, expect, test } from "bun:test";
import { ConflictError } from "../../src/errors/conflict-error";
import { MediaInUseError } from "../../src/errors/media-in-use-error";

describe("MediaInUseError", () => {
  test("extends ConflictError and carries the media_in_use code", () => {
    const error = new MediaInUseError("in use", "DELETE", "/api/media/01J8", 3, 1, false, []);
    expect(error).toBeInstanceOf(ConflictError);
    expect(error.status).toBe(409);
    expect(error.code).toBe("media_in_use");
    expect(error.name).toBe("MediaInUseError");
  });

  test("fromWireDetails reads the wire's snake_case OBJECT, not an array, and maps referrers through MediaAssetMapper", () => {
    const referrer = { media_id: "01J8", project: "acme", env: "prod", collection: "posts", entry_id: "01K1" };
    const error = MediaInUseError.fromWireDetails("in use", "DELETE", "/api/media/01J8", {
      usage_count: 3,
      visible_count: 1,
      visible_capped: true,
      referrers: [referrer],
    });

    expect(error.usageCount).toBe(3);
    expect(error.visibleCount).toBe(1);
    expect(error.visibleCapped).toBe(true);
    expect(error.referrers).toEqual([
      { mediaId: "01J8", project: "acme", environment: "prod", collection: "posts", entryId: "01K1" },
    ]);
  });

  test("fromWireDetails survives a missing or malformed details object", () => {
    const error = MediaInUseError.fromWireDetails("in use", "DELETE", "/api/media/01J8", undefined);
    expect(error.usageCount).toBe(0);
    expect(error.visibleCount).toBe(0);
    expect(error.visibleCapped).toBe(false);
    expect(error.referrers).toEqual([]);
  });
});
