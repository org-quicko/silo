import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { ValidationError } from "@silo/shared/validation-error";
import { ManifestReader, SiloApi } from "../../src/plugins";
import { HookNames } from "../../src/core/hooks";
import { Scaffold } from "../../../../packages/create-silo-plugin/src/scaffold";
import { SiloRange } from "../../../../packages/create-silo-plugin/src/silo-range";
import { OptionsResolver } from "../../../../packages/create-silo-plugin/src/options-resolver";
import { Arguments } from "../../../../packages/create-silo-plugin/src/arguments";
import type { ScaffoldOptions } from "../../../../packages/create-silo-plugin/src/scaffold-options";

/**
 * What `create-silo-plugin` emits, run through silo itself.
 *
 * The drift test next door pins the *vocabulary* the scaffolder copies; this
 * pins the *output*. A scaffolder is only worth having if its first result
 * works, and "works" here has a precise meaning that no assertion about file
 * contents reaches: silo's own `ManifestReader` accepts the manifest without
 * executing anything, and the module it names really does export the hooks the
 * manifest declares — a mismatch there refuses the start.
 *
 * The module is imported into the host realm with `silo:api` registered, which
 * is the path a *provider* takes. That is deliberate and is not a claim that
 * extensions load this way: they run in a `Worker`, and
 * `create-silo-plugin-worker.test.ts` is where that is exercised. Splitting
 * them means the assertions about generated *code* stay runnable on a Bun that
 * cannot start the worker host, instead of going red for a reason that has
 * nothing to do with the scaffolder.
 */
describe("create-silo-plugin output", () => {
  let tempDir: string;

  /** Defaults matching what `--yes` produces, so a test that overrides one
   *  field is testing that field. */
  const options = (over: Partial<ScaffoldOptions> = {}): ScaffoldOptions => ({
    name: "silo-plugin-slugs",
    directory: path.join(tempDir, "plugins", over.name ?? "silo-plugin-slugs"),
    kind: "extension",
    siloRange: SiloRange.default(),
    hooks: ["entry.beforeValidate"],
    routes: [],
    runtime: false,
    panel: false,
    claims: [],
    withConfig: true,
    force: false,
    ...over,
  });

  /**
   * Scaffold straight into `<data dir>/plugins/`, then resolve it the way silo
   * does — which is the real installation rule at 1.0 (a directory you place),
   * not a path trick.
   */
  const scaffold = async (over: Partial<ScaffoldOptions> = {}) => {
    const opts = options(over);
    await Scaffold.create(opts);
    const resolved = await ManifestReader.read(path.join(tempDir, "plugins"), opts.name);

    SiloApi.register();
    const module = await import(Bun.pathToFileURL(resolved.entry).href);
    return { opts, resolved, module };
  };

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "create-silo-plugin-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test("the default scaffold produces a manifest silo reads without running it", async () => {
    const { resolved, opts } = await scaffold();

    expect(resolved.manifest.contributes.hooks).toEqual(["entry.beforeValidate"]);
    expect(resolved.manifest.contributes.providers).toEqual([]);
    expect(resolved.manifest.silo).toBe(SiloRange.default());
    expect(resolved.entry).toBe(path.join(opts.directory, "index.ts"));
  });

  test("the version range it defaults to admits the silo it was cut alongside", async () => {
    // The reason the range is derived from the tool's own version rather than
    // hard-coded to the spec's `^1`: a scaffold that cannot load against the
    // current build is a broken starting point. `PluginLoader.compatible` is
    // the gate `serve` applies, including `VersionRange`'s rule about the
    // `-dev` suffix every non-release build carries.
    const { PluginLoader } = await import("../../src/plugins");
    const { resolved } = await scaffold();

    expect(PluginLoader.compatible(resolved.manifest.silo)).toBe(true);
  });

  test("every hook it declares, the module exports", async () => {
    // A declared hook the module does not export refuses the start, so
    // scaffolding all five is the only check that the generated property names
    // and the manifest agree — for all of them at once.
    const { resolved, module } = await scaffold({
      name: "silo-plugin-everything",
      hooks: [...HookNames.All],
    });

    const exported = resolved.manifest.contributes.hooks.filter(
      (hook: string) => typeof module.default[hook] === "function"
    );
    expect(exported).toEqual([...HookNames.All]);
  });

  test("the beforeValidate stub rewrites data, and rejects with a ValidationError", async () => {
    const { module } = await scaffold();
    const ctx = { config: { collection: "posts" } };

    const result = module.default["entry.beforeValidate"](
      { op: "create", origin: "api", collection: "posts", data: { title: "Hello Plugin World" } },
      ctx
    );
    expect(result).toEqual({ data: { title: "Hello Plugin World", slug: "hello-plugin-world" } });

    // Another collection is left alone — the guard every generated stub opens
    // with, and the first thing an author would otherwise get wrong.
    expect(
      module.default["entry.beforeValidate"](
        { op: "create", origin: "api", collection: "pages", data: { title: "Untouched" } },
        ctx
      )
    ).toBeUndefined();

    // A rejection, not a fault: `ValidationError` is what surfaces as a 400.
    expect(() =>
      module.default["entry.beforeValidate"](
        { op: "create", origin: "api", collection: "posts", data: {} },
        ctx
      )
    ).toThrow(ValidationError);
  });

  test("a scaffold with no config schema reads its collection from a constant", async () => {
    // `--no-config` emits a `Collection` constant instead of reading
    // `ctx.config`, and the manifest then declares no schema at all — which is
    // what lets `[plugins.config]` be omitted entirely.
    const { resolved, module } = await scaffold({ name: "silo-plugin-bare", withConfig: false });
    expect(resolved.manifest.config).toBeUndefined();

    const result = module.default["entry.beforeValidate"](
      { op: "create", origin: "api", collection: "posts", data: { title: "No Config Here" } },
      { config: {} }
    );
    expect(result).toEqual({ data: { title: "No Config Here", slug: "no-config-here" } });
  });

  test("a provider scaffold produces a manifest silo accepts, and a create()", async () => {
    // Not constructed: every method of a scaffolded provider throws until it is
    // written, and `PluginLoader` would install this as the instance's store.
    // The manifest and the factory's shape are the scaffolder's responsibility;
    // the bodies are the author's.
    const { resolved, module } = await scaffold({
      name: "silo-plugin-turso",
      kind: "provider",
      port: "storage",
      driver: "turso",
      hooks: [],
      // Extension-only; `OptionsResolver` forces it false for a provider, and
      // this constructs `ScaffoldOptions` directly.
      withConfig: false,
    });

    // One entry in a list, each provider naming its own module (D36): a package
    // can contribute a driver and hooks at once, and the two cannot be imported
    // from the same file because only one of them may run before the store exists.
    expect(resolved.manifest.contributes.providers).toEqual([
      { port: "storage", driver: "turso", entry: "./index.ts" },
    ]);

    // No config schema, and deliberately: the scaffolded one is the single
    // `collection` key every hook stub reads, which a provider has nothing to
    // do with — carrying it would demand a `collection` in `silo.toml` that
    // nothing consumes, and refuse the start without one.
    expect(resolved.manifest.config).toBeUndefined();

    expect(typeof module.default.create).toBe("function");
    await expect((await module.default.create({}, {})).put({}, {})).rejects.toThrow(/not implemented/);
  });

  test("it refuses to overwrite a directory someone is already working in", async () => {
    const dir = path.join(tempDir, "occupied");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "index.ts"), "// mine\n", "utf8");

    await expect(Scaffold.create(options({ directory: dir }))).rejects.toThrow(/not empty/);
    expect(await fs.readFile(path.join(dir, "index.ts"), "utf8")).toBe("// mine\n");

    await Scaffold.create(options({ directory: dir, force: true }));
    expect(await fs.readFile(path.join(dir, "index.ts"), "utf8")).toContain("defineSiloPlugin");
  });

  test("--yes resolves the same options a prompt would default to", async () => {
    // The one guard on "a flag skips its question": the scripted path and the
    // interactive path share `OptionsResolver`, so a default that exists on
    // only one of them is a bug this catches.
    const resolved = await OptionsResolver.resolve(Arguments.parse(["silo-plugin-slugs", "--yes"]));

    expect(resolved).toEqual({
      name: "silo-plugin-slugs",
      directory: "silo-plugin-slugs",
      kind: "extension",
      siloRange: SiloRange.default(),
      hooks: ["entry.beforeValidate"],
      routes: [],
      runtime: false,
      panel: false,
      claims: [],
      withConfig: true,
      force: false,
    });
  });

  /**
   * The rule is "something would call it", not "it declares a hook" (D36, D41).
   *
   * This test used to assert the second, because that is what the tool enforced
   * and what `ManifestReader` enforced before D36 — so a routes-only plugin was
   * unscaffoldable and an author had to name a hook they did not want. Which is
   * exactly D36's complaint about `kind`, surviving in the tool three phases
   * after the manifest stopped agreeing with it.
   */
  test("a plugin that contributes nothing at all is refused, and a routes-only one is not", async () => {
    await expect(
      OptionsResolver.resolve(Arguments.parse(["silo-plugin-empty", "--yes", "--hooks", ""]))
    ).rejects.toThrow(/contributes nothing would never be called/);

    const routesOnly = await OptionsResolver.resolve(
      Arguments.parse(["silo-plugin-routes", "--yes", "--hooks", "", "--routes", "GET /status"])
    );
    expect(routesOnly.hooks).toEqual([]);
    expect(routesOnly.routes).toEqual([{ method: "GET", path: "/status" }]);

    // And asking for a route with nothing else does not quietly add a hook: an
    // unattended default that granted authority over every write in the instance
    // is the largest thing this tool could do behind an author's back.
    const unattended = await OptionsResolver.resolve(
      Arguments.parse(["silo-plugin-routes", "--yes", "--routes", "GET /status"])
    );
    expect(unattended.hooks).toEqual([]);
  });

  test("--config against a provider says so rather than doing nothing", async () => {
    // A flag that looks honoured and is not is worse than one that says it
    // does not apply.
    await expect(
      OptionsResolver.resolve(
        Arguments.parse(["silo-plugin-x", "--yes", "--kind", "provider", "--config"])
      )
    ).rejects.toThrow(/extension-only/);
  });

  test("a reserved driver name is refused", async () => {
    // Shadowing `sqlite` is a data-loss shape — an installed package silently
    // becoming the store an instance already has data in — so this is refused,
    // not warned about.
    await expect(
      OptionsResolver.resolve(
        Arguments.parse(["silo-plugin-x", "--yes", "--kind", "provider", "--driver", "sqlite"])
      )
    ).rejects.toThrow(/reserved driver name/);
  });
});
