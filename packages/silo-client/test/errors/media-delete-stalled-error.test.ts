import { describe, expect, test } from "bun:test";
import { MediaDeleteStalledError } from "../../src/errors/media-delete-stalled-error";
import { SiloError } from "../../src/errors/silo-error";

describe("MediaDeleteStalledError", () => {
  test("is a SiloError, 500, with its own code", () => {
    const error = new MediaDeleteStalledError("stalled", "DELETE", "/api/media/01J8", "silo media reconcile");
    expect(error).toBeInstanceOf(SiloError);
    expect(error.status).toBe(500);
    expect(error.code).toBe("media_delete_stalled");
    expect(error.remedy).toBe("silo media reconcile");
  });

  test("fromWireDetails reads remedy from the wire's details object", () => {
    const error = MediaDeleteStalledError.fromWireDetails("stalled", "DELETE", "/api/media/01J8", {
      media_id: "01J8",
      blob_key: "media/01J8.png",
      reason: "access denied",
      remedy: "silo media reconcile",
    });

    expect(error.remedy).toBe("silo media reconcile");
  });

  test("fromWireDetails survives a missing details object", () => {
    const error = MediaDeleteStalledError.fromWireDetails("stalled", "DELETE", "/api/media/01J8", undefined);
    expect(error.remedy).toBe("");
  });
});
