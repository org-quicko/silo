import { describe, expect, test } from "bun:test";
import { MediaFolderName } from "../src/media/media-folder-name";

/** The rule the server holds a folder path to, and the admin asks before it
 *  uploads a whole tree (D105). */
describe("media folder names", () => {
  test("take letters, digits, spaces, dots, dashes and underscores after a letter or digit", () => {
    for (const name of ["photos", "2024", "Q1 report", "v1.2", "a_b-c", "A"]) {
      expect(MediaFolderName.segmentProblem(name)).toBeNull();
    }
  });

  test("refuse a name that starts with anything else, or holds anything else", () => {
    for (const name of ["_assets", ".git", "-x", " x", "photos (2)", "café", "a/b", "", ".", ".."]) {
      expect(MediaFolderName.segmentProblem(name)).toBe(`invalid folder segment "${name}"`);
    }
  });

  test("allow 64 characters and refuse 65", () => {
    expect(MediaFolderName.segmentProblem("a".repeat(64))).toBeNull();
    expect(MediaFolderName.segmentProblem("a".repeat(65))).toBe(
      `folder segment "${"a".repeat(65)}" is longer than 64 characters`
    );
  });

  test("allow 16 levels and refuse 17", () => {
    expect(MediaFolderName.depthProblem(16)).toBeNull();
    expect(MediaFolderName.depthProblem(17)).toBe("folder is deeper than 16 levels");
  });
});
