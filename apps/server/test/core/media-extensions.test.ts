import { describe, expect, test } from "bun:test";
import { ValidationError } from "@silo/shared/validation-error";
import { MediaExtensions } from "../../src/core/media/media-extensions";
import { MediaDefaults } from "../../src/config/media-defaults";
import { MediaTable } from "../../src/config/media-table";

/**
 * What the library takes in (D46).
 *
 * An allowlist is only worth having if it cannot be walked around, so the
 * cases that matter are the ones where a filename is almost, but not quite,
 * what it claims to be.
 */
describe("MediaExtensions", () => {
  const allowed = ["jpg", "png", "pdf"];

  test("a listed extension is accepted whatever its case", () => {
    expect(MediaExtensions.allows(allowed, "photo.PNG")).toBe(true);
    expect(MediaExtensions.allows(allowed, "report.pdf")).toBe(true);
  });

  test("an unlisted one is refused, and the message says what is taken", () => {
    expect(() => MediaExtensions.assert(allowed, "payload.exe")).toThrow(ValidationError);
    expect(() => MediaExtensions.assert(allowed, "payload.exe")).toThrow(/jpg, pdf, png/);
  });

  test("only the last extension counts", () => {
    // "invoice.pdf.exe" is an .exe. Reading the first extension is the classic
    // way an allowlist is talked past.
    expect(MediaExtensions.allows(allowed, "invoice.pdf.exe")).toBe(false);
    expect(MediaExtensions.allows(allowed, "archive.tar.gz")).toBe(false);
  });

  test("a file with no extension is refused rather than waved through", () => {
    expect(MediaExtensions.allows(allowed, "README")).toBe(false);
    expect(() => MediaExtensions.assert(allowed, "README")).toThrow(/no extension/);
  });

  test("a dotfile has no extension either", () => {
    // ".gitignore" is a name beginning with a dot, not a file of type
    // "gitignore" — `MediaPaths.blobKey` reads it the same way.
    expect(MediaExtensions.allows(allowed, ".gitignore")).toBe(false);
  });

  test("a path is not a way to smuggle a different name past the check", () => {
    expect(MediaExtensions.allows(allowed, "a.png/../evil.exe")).toBe(false);
    expect(MediaExtensions.allows(allowed, "c:\\tmp\\evil.exe")).toBe(false);
  });

  test('"*" turns the check off, and is the only thing that does', () => {
    expect(MediaExtensions.allows([MediaExtensions.Any], "payload.exe")).toBe(true);
    expect(MediaExtensions.allows([MediaExtensions.Any], "README")).toBe(true);
  });

  test("an empty list accepts nothing at all", () => {
    // Which is why `MediaPolicySettings.parse` refuses to save one: a library
    // that takes no files is a mistake, not a policy.
    expect(MediaExtensions.allows([], "photo.png")).toBe(false);
  });

  test("the defaults are normalised already, so the check can compare directly", () => {
    expect(MediaTable.extensions([...MediaDefaults.Extensions])).toEqual([
      ...MediaDefaults.Extensions,
    ]);
    expect(MediaExtensions.allows(MediaDefaults.Extensions, "hero.jpg")).toBe(true);
    expect(MediaExtensions.allows(MediaDefaults.Extensions, "notes.docx")).toBe(false);
  });
});

describe("MediaTable.extensions", () => {
  test("dots, case, blanks and duplicates are all cleaned off", () => {
    expect(MediaTable.extensions([".JPG", "png ", "", "jpg", "PNG", 7, null])).toEqual([
      "jpg",
      "png",
    ]);
  });
});
