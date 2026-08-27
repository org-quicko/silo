import { describe, test, expect } from "bun:test";
import fs from "fs/promises";
import path from "path";
import {
  PluginApiContract,
  PluginClientSource,
  PluginTypesSource,
  WorkerSource,
} from "../../src/plugins";

const TypesFile = path.resolve(
  import.meta.dir,
  "../../src/plugins/host/silo-api-types.d.ts"
);

/**
 * The client a plugin is handed, described once and emitted twice (D35).
 *
 * Before this the surface was mirrored **by hand in three places** — the host's
 * method switch, the worker bootstrap that called it, and the declarations that
 * typed it — and nothing but review kept them in step. Two of the three are now
 * generated, and this is what keeps the third honest.
 */
describe("the plugin client has one source", () => {
  /**
   * Evaluate the emitted client against a recorder.
   *
   * `new Function` rather than a string comparison: what matters is not that
   * the generator emits particular characters but that the characters it emits
   * build the request the contract describes. A template bug that produced
   * `/api/projects/undefined/...` would pass any assertion about substrings.
   */
  const evaluate = () => {
    const calls: { method: string; path: string; options: unknown }[] = [];
    const body = [
      ...PluginClientSource.lines(),
      "return buildApi((method, path, options) => { calls.push({ method, path, options }); });",
    ].join("\n");

    const api = new Function("enc", "calls", body)(encodeURIComponent, calls);
    return { api, calls };
  };

  test("every declared operation is a callable method, and no others are", () => {
    const { api } = evaluate();

    const emitted: string[] = [];
    for (const group of Object.keys(api)) {
      for (const method of Object.keys(api[group])) emitted.push(`${group}.${method}`);
    }

    expect(emitted.sort()).toEqual(
      PluginApiContract.Operations.map((operation) => operation.name).sort()
    );
  });

  test("a scoped call builds the path the route is registered at", () => {
    const { api, calls } = evaluate();

    api.entries.list({ project: "acme", env: "staging" }, "posts", { limit: 2 });

    expect(calls[0]).toEqual({
      method: "GET",
      path: "/api/projects/acme/environments/staging/collections/posts",
      options: { query: { limit: 2 } },
    });
  });

  test("every interpolated segment is encoded", () => {
    const { api, calls } = evaluate();

    // Not because the server would accept it — it would not — but because a
    // client that builds a different request than the one it was asked to is
    // wrong on its own terms.
    api.entries.get({ project: "acme", env: "prod" }, "posts", "a/../b");

    expect(calls[0]!.path).toBe("/api/projects/acme/environments/prod/collections/posts/a%2F..%2Fb");
  });

  test("a write carries its body and its expected revision", () => {
    const { api, calls } = evaluate();

    api.entries.update({ project: "acme", env: "prod" }, "posts", "abc", { title: "x" }, 3);

    expect(calls[0]!.method).toBe("PUT");
    expect(calls[0]!.options).toEqual({ body: { title: "x" }, rev: 3 });
  });

  test("the bootstrap the worker runs carries the generated client", () => {
    // The worker half is generated at start rather than checked in, so there is
    // no second copy to drift — but the splice itself can be lost, and a worker
    // whose `buildCtx` references a missing `buildApi` fails at dispatch time
    // with a message about nothing in particular.
    const code = WorkerSource.code();
    expect(code).toContain("const buildApi = (call) => ({");
    expect(code).toContain("buildApi(buildCall(fetch))");
  });

  /**
   * The `.d.ts` is the one copy that has to exist as a file, because `tsc`
   * reads files and a plugin author's editor reads `tsc`.
   *
   * Compared newline-normalised. The bytes-for-bytes guarantee that matters is
   * the *other* drift test, which pins silo's declarations against the copy
   * `create-silo-plugin` publishes; this one is about content, and a working
   * tree may hold either line ending.
   */
  test("the declarations between the markers are the generated ones", async () => {
    const source = (await fs.readFile(TypesFile, "utf8")).replace(/\r\n/g, "\n");
    const generated = PluginTypesSource.marked();

    if (!source.includes(generated)) {
      const begin = source.indexOf(PluginTypesSource.Begin);
      const end = source.indexOf(PluginTypesSource.End);
      const found =
        begin === -1 || end === -1
          ? "(no generated block found)"
          : source.slice(begin, end + PluginTypesSource.End.length);
      expect({ found }).toEqual({ found: generated });
    }
    expect(source).toContain(generated);
  });
});
