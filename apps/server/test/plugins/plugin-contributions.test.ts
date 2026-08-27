import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { SqliteStore } from "../../src/adapters/storage/sqlite/sqlite-store";
import { SiloService } from "../../src/core/services/silo-service";
import { Scope } from "../../src/core/domain/scope";
import { Logger } from "../../src/logging/logger";
import { SiloServer } from "../../src/http/server";
import {
  ManifestReader,
  PluginGrantResolver,
  PluginLoader,
  PluginRegistry,
  ProviderRegistry,
} from "../../src/plugins";
import type { PluginConfig } from "../../src/config/plugin-config";
import { ConfigLoader } from "../../src/config/config-loader";

const Fixtures = path.join(import.meta.dir, "fixtures");

function pluginConfig(name: string, over: Partial<PluginConfig> = {}): PluginConfig {
  return { name, claims: [], timeout_ms: 5000, on_error: "fail", config: {}, ...over };
}

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (caught) {
    return caught as Error;
  }
  throw new Error("expected a rejection, got none");
}

/**
 * `contributes` and `permissions`: the manifest D36 replaced `kind` and a flat
 * `claims` array with.
 *
 * Two claims are being tested, and they are the two D36 makes. That a package is
 * **not one thing or the other** — it contributes any combination, and the
 * combinations `kind` forbade were arbitrary. And that a permission carries
 * **whether the plugin needs it and why**, because a default grant has to pick
 * something and an operator approving a claim deserves the author's reason for
 * asking.
 */
describe("what a package contributes (D36)", () => {
  const manifest = (silo: Record<string, unknown>) =>
    ManifestReader.validate("acme", { name: "acme", silo: { silo: "*", ...silo } });

  describe("the manifest", () => {
    /**
     * The retired keys are refused by name rather than ignored.
     *
     * Reading the old shape too was the alternative and is worse in a way that
     * matters: a `claims` array silently dropped is a plugin that asks for
     * nothing, which loads, looks healthy and cannot work — and a package could
     * ask for a claim with no reason attached simply by using the older spelling.
     */
    test.each([
      ["kind", { kind: "extension", contributes: { hooks: ["entry.afterWrite"] } }],
      ["hooks", { hooks: ["entry.afterWrite"], contributes: { runtime: true } }],
      ["routes", { routes: [], contributes: { runtime: true } }],
      ["provider", { provider: { port: "blob", driver: "x" }, contributes: { runtime: true } }],
      ["claims", { claims: [], contributes: { runtime: true } }],
    ])('the retired "silo.%s" is refused, naming what replaced it', (key, silo) => {
      expect(() => manifest(silo)).toThrow(new RegExp(`"silo\\.${key}" was removed in D36`));
    });

    /**
     * The combination `kind` made impossible.
     *
     * Not an oversight in the old field but the thing it was: an enum has one
     * value, so a storage provider could not register the hook that keeps its own
     * derived data in step, and a package that wanted a background timer had to
     * invent a hook merely to be loaded.
     */
    test("a package may contribute hooks and a provider at once", () => {
      const read = manifest({
        contributes: {
          hooks: ["entry.afterWrite"],
          providers: [{ port: "blob", driver: "memo", entry: "./blob.ts" }],
        },
      });

      expect(read.contributes.hooks).toEqual(["entry.afterWrite"]);
      expect(read.contributes.providers).toEqual([
        { port: "blob", driver: "memo", entry: "./blob.ts" },
      ]);
    });

    /** A runtime is enough on its own. This is the package that could not exist
     *  before: no hooks, no routes, and something to do at startup. */
    test("a runtime alone is a package", () => {
      expect(manifest({ contributes: { runtime: true } }).contributes.runtime).toBe(true);
    });

    test("contributing nothing is refused, because nothing would call it", () => {
      expect(() => manifest({ contributes: {} })).toThrow(/declares nothing/);
      expect(() => manifest({ contributes: { runtime: false, hooks: [] } })).toThrow(
        /declares nothing/
      );
    });

    /** The load-order argument as a validation rule: a provider is imported into
     *  the host before storage exists, and the worker half is not. */
    test("a provider must name its own entry module", () => {
      expect(() =>
        manifest({ contributes: { providers: [{ port: "storage", driver: "pg" }] } })
      ).toThrow(/needs an "entry"/);
    });

    test("two providers on the same port and driver are refused", () => {
      expect(() =>
        manifest({
          contributes: {
            providers: [
              { port: "blob", driver: "memo", entry: "./a.ts" },
              { port: "blob", driver: "memo", entry: "./b.ts" },
            ],
          },
        })
      ).toThrow(/declared more than once/);
    });
  });

  describe("permissions", () => {
    const withPermissions = (permissions: Record<string, unknown>) =>
      manifest({ contributes: { runtime: true }, permissions });

    /**
     * A reason is required, and that looks like ceremony until you ask what the
     * grant screen shows without one. An author who may omit it will, and a blank
     * line beside a delete claim tells an operator that nothing needs saying.
     */
    test("a permission with no reason is refused, naming the claim", () => {
      expect(() =>
        withPermissions({ required: [{ claim: "media:read" }] })
      ).toThrow(/permission "media:read" needs a "reason"/);
      expect(() =>
        withPermissions({ required: [{ claim: "media:read", reason: "   " }] })
      ).toThrow(/needs a "reason"/);
    });

    test("an unparseable claim is refused at the manifest, not at request time", () => {
      expect(() =>
        withPermissions({ optional: [{ claim: "media:levitate", reason: "why not" }] })
      ).toThrow(/invalid claim in "silo.permissions.optional"/);
    });

    /** It is either needed or it is not; a default grant would have to pick a
     *  reading, and either choice makes one of the two words a lie. */
    test("the same claim required and optional is refused", () => {
      expect(() =>
        withPermissions({
          required: [{ claim: "media:read", reason: "a" }],
          optional: [{ claim: "media:read", reason: "b" }],
        })
      ).toThrow(/declared both required and optional/);
    });
  });

  describe("the request derived from a manifest", () => {
    /**
     * Hook claims and `http:route` are **computed**, not restated.
     *
     * The same argument D34 made for hook claims: a plugin already declares its
     * hooks, and writing them out again as claims is two lists to keep in step.
     * D36 extends it to routes, where phase 6 had left the author to remember
     * `http:route` by hand — which is exactly why `assertServable` had to exist.
     */
    test("a declared hook and a declared route each derive their own claim", () => {
      const read = manifest({
        contributes: {
          hooks: ["entry.beforeWrite"],
          routes: [{ method: "GET", path: "/health" }],
        },
        permissions: { optional: [{ claim: "media:read", reason: "for the digest" }] },
      });

      const request = PluginGrantResolver.request(read);
      expect(request.claims).toContain("hooks:*/*/*:entry.beforeWrite");
      expect(request.claims).toContain("http:route");
      expect(request.claims).toContain("media:read");

      // Derived claims are required, and not because the author said so: a hook
      // nothing delivers and a route that answers 403 both refuse the start.
      expect(request.required).toEqual(["hooks:*/*/*:entry.beforeWrite", "http:route"]);
      expect(request.required).not.toContain("media:read");
    });

    /**
     * A grant short of a required claim is reported, and still runs.
     *
     * Warned rather than refused, and the boundary is the boot deadlock D34
     * exists to avoid: pending is an empty claim list, so refusing here would
     * refuse every unapproved plugin. What the split fixes is the silence — a
     * plugin narrowed to two of five claims on purpose and one granted two by
     * accident used to look identical, and only the author's own `required` list
     * tells them apart.
     */
    test("a grant missing a required claim is unmet, and an optional one is not", () => {
      const read = manifest({
        contributes: { runtime: true },
        permissions: {
          required: [{ claim: "media:read", reason: "To list the media." }],
          optional: [{ claim: "media:create", reason: "To upload thumbnails." }],
        },
      });

      const narrow = PluginGrantResolver.resolve(
        { name: "acme", claims: [], timeout_ms: 5000, on_error: "fail", config: {} },
        read,
        { name: "acme", requested: [], hooks: [], granted: ["media:create"], state: "granted",
          manifest_digest: "", granted_by: null }
      );

      expect(narrow.unmet).toEqual(["media:read"]);
      expect(narrow.missing).toEqual(["media:read"]);

      const full = PluginGrantResolver.resolve(
        { name: "acme", claims: [], timeout_ms: 5000, on_error: "fail", config: {} },
        read,
        { name: "acme", requested: [], hooks: [], granted: ["media:read"], state: "granted",
          manifest_digest: "", granted_by: null }
      );

      // The optional one is ungranted and that is not a problem — which is the
      // whole of what `optional` means.
      expect(full.unmet).toEqual([]);
      expect(full.missing).toEqual(["media:create"]);
    });

    /** Every row on a grant screen has something to say about itself, including
     *  the rows no author wrote. */
    test("every claim has a reason, derived ones included", () => {
      const read = manifest({
        contributes: { hooks: ["entry.afterWrite"], routes: [{ method: "GET", path: "/a" }] },
        permissions: { required: [{ claim: "media:read", reason: "To list the media." }] },
      });

      const request = PluginGrantResolver.request(read);
      for (const claim of request.claims) expect(request.reasons[claim]).toBeTruthy();
      expect(request.reasons["media:read"]).toBe("To list the media.");
      expect(request.reasons["hooks:*/*/*:entry.afterWrite"]).toContain("entry.afterWrite");
      expect(request.reasons["http:route"]).toContain("/api/ext/acme/");
    });
  });

  describe("loading", () => {
    let tempDir: string;
    let store: SqliteStore;
    let service: SiloService;
    let registry: PluginRegistry | null = null;
    const scope = Scope.Default;

    const load = async (plugins: PluginConfig[]) => {
      for (const plugin of plugins) {
        await fs.cp(path.join(Fixtures, plugin.name), path.join(tempDir, "plugins", plugin.name), {
          recursive: true,
        });
      }
      const config = ConfigLoader.defaultConfig();
      config.storage.path = tempDir;
      config.plugins = plugins;
      registry = await PluginRegistry.load(config, service, Logger.silent());
      service.useHooks(registry.hooks());
      registry.attach(
        new SiloServer(service, {
          version: "test",
          authDisabled: false,
          logger: Logger.silent(),
        }).build()
      );
      await registry.activate();
      return registry;
    };

    const mirrored = async (): Promise<string[]> => {
      const page = await service.entries.list(scope, "mirrors", {});
      return page.items.map((entry: any) => entry.data.title);
    };

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-contributes-test-"));
      store = await SqliteStore.open(path.join(tempDir, "test.db"));
      service = new SiloService(store, { mediaDir: path.join(tempDir, "media") });
      await service.scopes.initDefaults();
      await service.collections.putSchema(scope, "mirrors", {
        type: "object",
        properties: { title: { type: "string" } },
      });
    });

    afterEach(async () => {
      await registry?.stop();
      registry = null;
      await store.close();
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    });

    /**
     * `activate` runs, and it can **act**.
     *
     * Two claims, and the second is the one worth making: `ctx` inside `activate`
     * dispatches against the same app a hook's does, which is why activation is a
     * step of its own after the app is attached rather than part of starting the
     * worker.
     */
    test("a runtime-only plugin loads, and its activate acts through ctx", async () => {
      const loaded = await load([
        pluginConfig("ticker", { claims: ["collections:*/*/*:entries:create"] }),
      ]);

      expect(loaded.list()).toHaveLength(1);
      expect(loaded.find("ticker")!.hooks).toEqual([]);
      expect(await mirrored()).toEqual(["activated"]);
    }, 30000);

    /** Idempotent, so the boot pass and a live `enable` can both drive it
     *  without either knowing whether the other already did. */
    test("activating twice activates once", async () => {
      const loaded = await load([
        pluginConfig("ticker", { claims: ["collections:*/*/*:entries:create"] }),
      ]);

      await loaded.activate();
      await loaded.activate();
      expect(await mirrored()).toEqual(["activated"]);
    }, 30000);

    /** The other half runs on the way out, which is what makes `activate` safe to
     *  use for anything that needs releasing. */
    test("stopping runs deactivate before the worker is torn down", async () => {
      const loaded = await load([
        pluginConfig("ticker", { claims: ["collections:*/*/*:entries:create"] }),
      ]);

      await loaded.stop();
      registry = null;
      expect(await mirrored()).toEqual(["activated", "deactivated"]);
    }, 30000);

    /** The same rule a declared hook has, for the same reason: from outside, a
     *  plugin whose `activate` never ran looks exactly like one whose setup
     *  succeeded. */
    test("declaring a runtime and exporting none is refused", async () => {
      const failed = await rejection(load([pluginConfig("halfwit")]));
      expect(failed.message).toMatch(/declares activate, deactivate but exports no such function/);
    }, 30000);

    /**
     * The dual package, loaded both ways.
     *
     * Its provider is registered from `blob.ts` into the host before storage
     * exists, and its hook half runs in a worker afterwards — two entry modules
     * because only one of them may be imported at that first moment.
     */
    test("a package contributing both is loaded twice, from two entries", async () => {
      const config = pluginConfig("dualist", {
        claims: [...["hooks:*/*/*:entry.afterWrite"], "collections:*/*/*:entries:read"],
      });

      const providers = ProviderRegistry.withBuiltins();
      await fs.cp(path.join(Fixtures, "dualist"), path.join(tempDir, "plugins", "dualist"), {
        recursive: true,
      });
      const loadedProviders = await PluginLoader.loadProviders(
        path.join(tempDir, "plugins"),
        [config],
        providers
      );

      expect(loadedProviders).toEqual(["dualist"]);
      expect(providers.drivers().blob).toContain("memo");

      const loaded = await load([config]);
      expect(loaded.find("dualist")!.hooks).toEqual(["entry.afterWrite"]);
    }, 30000);

    /**
     * A package contributing only providers gets no worker and no grant record.
     *
     * Not an exception carved out for it but the same rule stated positively: a
     * provider is constructed before the store exists, so it could not be
     * authorized from inside the store even if there were somewhere to say so.
     */
    test("a provider-only package has no runtime to prepare", async () => {
      await fs.cp(path.join(Fixtures, "dualist"), path.join(tempDir, "plugins", "solo"), {
        recursive: true,
      });
      const manifestPath = path.join(tempDir, "plugins", "solo", "package.json");
      const pkg = JSON.parse(await fs.readFile(manifestPath, "utf8"));
      pkg.silo.contributes = {
        providers: [{ port: "blob", driver: "solo", entry: "./blob.ts" }],
      };
      delete pkg.silo.permissions;
      await fs.writeFile(manifestPath, JSON.stringify(pkg, null, 2), "utf8");

      const prepared = await PluginLoader.prepare(
        {
          pluginsDir: path.join(tempDir, "plugins"),
          service,
          logger: Logger.silent(),
          dispatcher: PluginRegistry.empty(Logger.silent()).api(),
        },
        pluginConfig("solo")
      );

      expect(prepared).toBeNull();
      expect(await service.plugins.find("solo")).toBeNull();
    }, 30000);
  });

  describe("required and optional in the record", () => {
    let tempDir: string;
    let store: SqliteStore;
    let service: SiloService;

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-permissions-test-"));
      store = await SqliteStore.open(path.join(tempDir, "test.db"));
      service = new SiloService(store, { mediaDir: path.join(tempDir, "media") });
      await service.scopes.initDefaults();
    });

    afterEach(async () => {
      await store.close();
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    });

    /**
     * `required` is stored, not looked up.
     *
     * D38's rule for the management surface is that it acts on the record and
     * never on the filesystem, and `PUT .../grant` with no body means "approve the
     * default". Without `required` in the record that default would have to read
     * the package, which is the coupling the rule exists to prevent.
     */
    test("the record carries which claims are required", async () => {
      const record = await service.plugins.reconcile(
        "acme",
        ["media:read", "media:create"],
        [],
        ["media:read"]
      );

      expect(record.requested).toEqual(["media:read", "media:create"]);
      expect(record.required).toEqual(["media:read"]);
    });

    /**
     * Promoting an optional claim to required is a change to the request.
     *
     * It changes what "approve the default" would approve without changing a
     * single claim in the list, so a digest over the claims alone would have let
     * a package widen a default grant silently at the next start.
     */
    test("moving a claim from optional to required needs review", async () => {
      await service.plugins.reconcile("acme", ["media:read", "media:create"], [], ["media:read"]);
      await service.plugins.grant("acme", ["media:read"], { actor: { kind: "cli" } as any });

      const after = await service.plugins.reconcile(
        "acme",
        ["media:read", "media:create"],
        [],
        ["media:read", "media:create"]
      );

      expect(after.state).toBe("needs_review");
      // And it kept running on what it had: an upgrade never escalates.
      expect(after.granted).toEqual(["media:read"]);
    });

    /** A record written before the split has no `required`, and the honest
     *  reading of one is that everything in it was needed — there was no other
     *  kind. Defaulting to nothing would make a default grant approve nothing and
     *  report success. */
    test("a record with no required reads as all-required", async () => {
      const record = await service.plugins.reconcile("acme", ["media:read"], []);
      expect(record.required).toEqual(["media:read"]);
    });
  });
});
