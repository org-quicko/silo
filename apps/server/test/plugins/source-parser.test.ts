import { describe, test, expect } from "bun:test";
import path from "path";
import { SourceParser } from "../../src/plugins";

/**
 * `silo add` takes one argument and decides from its shape where to go looking
 * (D32). Nothing else in the CLI infers that much from a bare string, so the
 * classification is pinned here rather than left to the fetchers to discover:
 * the failure that matters is not an error message, it is installing from
 * somewhere the operator did not mean.
 */
describe("SourceParser", () => {
  describe("npm specs", () => {
    test("a bare name is the latest release of it", () => {
      expect(SourceParser.parse("silo-plugin-slug")).toEqual({
        kind: "npm",
        name: "silo-plugin-slug",
        range: "latest",
      });
    });

    test("a range is split from the last @, which is what scoped names need", () => {
      expect(SourceParser.parse("@acme/silo-plugin-slug@^1")).toEqual({
        kind: "npm",
        name: "@acme/silo-plugin-slug",
        range: "^1",
      });
    });

    test("a scoped name with no range keeps its leading @", () => {
      expect(SourceParser.parse("@acme/silo-plugin-slug")).toEqual({
        kind: "npm",
        name: "@acme/silo-plugin-slug",
        range: "latest",
      });
    });

    test("a dist-tag is a range like any other — the registry resolves it", () => {
      expect(SourceParser.parse("silo-plugin-slug@next")).toMatchObject({ range: "next" });
    });

    test("something that is neither a name nor a path is refused, not guessed at", () => {
      expect(() => SourceParser.parse("not a package!")).toThrow(/not a package name/);
    });
  });

  describe("local paths", () => {
    test("a directory is resolved to an absolute path", () => {
      expect(SourceParser.parse("./my-plugin")).toEqual({
        kind: "directory",
        path: path.resolve("./my-plugin"),
      });
    });

    test("a .tgz is a tarball, not a directory", () => {
      expect(SourceParser.parse("./silo-plugin-slug-1.2.0.tgz")).toMatchObject({ kind: "tarball" });
      expect(SourceParser.parse("../dist/plugin.tar.gz")).toMatchObject({ kind: "tarball" });
    });

    test("file: is accepted, because npm specs use it and habits carry over", () => {
      expect(SourceParser.parse("file:./my-plugin")).toEqual({
        kind: "directory",
        path: path.resolve("./my-plugin"),
      });
    });

    test("a bare name is never a path — that ambiguity resolves to the registry", () => {
      expect(SourceParser.parse("my-plugin").kind).toBe("npm");
    });
  });

  describe("URLs", () => {
    test("a tarball URL is fetched, not cloned", () => {
      expect(SourceParser.parse("https://example.com/silo-plugin-slug.tgz")).toEqual({
        kind: "url",
        url: "https://example.com/silo-plugin-slug.tgz",
      });
    });

    test("a query string does not hide the extension", () => {
      expect(SourceParser.parse("https://example.com/p.tgz?token=x").kind).toBe("url");
    });

    test("an unknown host with no extension is a tarball, which fails loudly", () => {
      // The safe default of the two: fetching something that turns out not to
      // be a tarball errors, whereas cloning a URL meant as a download would
      // quietly succeed at the wrong thing.
      expect(SourceParser.parse("https://example.com/downloads/plugin").kind).toBe("url");
    });
  });

  describe("git", () => {
    test("a known forge is a repository even with no .git suffix", () => {
      expect(SourceParser.parse("https://github.com/acme/silo-plugin-slug")).toEqual({
        kind: "git",
        url: "https://github.com/acme/silo-plugin-slug",
        ref: undefined,
      });
    });

    test("a .git suffix is a repository anywhere", () => {
      expect(SourceParser.parse("https://git.example.com/acme/x.git").kind).toBe("git");
    });

    test("npm's git+ prefix is stripped, because git does not want it", () => {
      expect(SourceParser.parse("git+https://github.com/acme/x.git")).toMatchObject({
        kind: "git",
        url: "https://github.com/acme/x.git",
      });
    });

    test("scp syntax is a repository", () => {
      expect(SourceParser.parse("git@github.com:acme/x.git").kind).toBe("git");
    });

    test("a release asset on a forge is still a tarball", () => {
      expect(SourceParser.parse("https://github.com/acme/x/releases/download/v1/x.tgz").kind).toBe(
        "url"
      );
    });

    test("--ref rides along, and only on a repository", () => {
      expect(SourceParser.parse("https://github.com/acme/x", "v1.2.0")).toMatchObject({
        ref: "v1.2.0",
      });
      expect(SourceParser.parse("silo-plugin-slug", "v1.2.0")).not.toHaveProperty("ref");
    });
  });
});
