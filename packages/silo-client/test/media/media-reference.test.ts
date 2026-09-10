import { describe, expect, test } from "bun:test";
import { MediaReference } from "../../src/media/media-reference";

describe("MediaReference", () => {
  test("of builds the silo://media/ scheme", () => {
    expect(MediaReference.of("01J8XYZ")).toBe("silo://media/01J8XYZ");
  });

  test("idOf round-trips a reference built by of()", () => {
    expect(MediaReference.idOf(MediaReference.of("01J8XYZ"))).toBe("01J8XYZ");
  });

  test("idOf rejects a non-reference", () => {
    expect(MediaReference.idOf("not a reference")).toBeNull();
    expect(MediaReference.idOf("/media/01J8XYZ.png")).toBeNull();
    expect(MediaReference.idOf("")).toBeNull();
    expect(MediaReference.idOf(null)).toBeNull();
    expect(MediaReference.idOf(42)).toBeNull();
  });

  test("idOf ignores a trailing fragment, query or path segment", () => {
    expect(MediaReference.idOf("silo://media/01J8XYZ#caption")).toBe("01J8XYZ");
    expect(MediaReference.idOf("silo://media/01J8XYZ?x=1")).toBe("01J8XYZ");
    expect(MediaReference.idOf("silo://media/01J8XYZ/extra")).toBe("01J8XYZ");
  });
});
