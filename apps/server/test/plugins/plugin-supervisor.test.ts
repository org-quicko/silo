import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { Hono } from "hono";
import { SqliteStore } from "../../src/adapters/storage/sqlite/sqlite-store";
import { SiloService } from "../../src/core/services/silo-service";
import { Scope } from "../../src/core/domain/scope";
import { Logger } from "../../src/logging/logger";
import { SiloServer } from "../../src/http/server";
import { PluginRegistry, PluginSupervisor } from "../../src/plugins";
import { ConfigLoader } from "../../src/config/config-loader";
import type { Config } from "../../src/config/config";

const Fixtures = path.join(import.meta.dir, "fixtures");
const scope = Scope.Default;

/** One `[[plugins]]` block, written the way an operator would. */
interface Block {
  name: string;
  claims?: string[];
  timeout_ms?: number;
  on_error?: string;
  config?: Record<string, unknown>;
}

/**
 * The supervisor: live enable, disable, revoke, reconfigure and rescan
 * (D39, phase 4).
 *
 * This file is §13.11's acceptance test and the debts phase 3 named. The
 * acceptance test is one sentence — *revoke it live, and prove **both** `ctx`
 * calls and hook delivery stop without a restart* — and the reason it is worth a
 * file is that the two halves have to be provable **separately**. A test that
 * only checked "the plugin stopped doing anything" would pass just as happily
 * against the half-fix §13.15 refused to ship, where `ctx` is dead while the
 * hooks still fire.
 *
 * Everything here goes through the HTTP API rather than calling the supervisor
 * directly, because the guarantee is about what an operator can do to a running
 * server, not about what a method does when called in isolation.
 */
describe("the plugin supervisor (D39)", () => {
  let tempDir: string;
  let tomlPath: string;
  let store: SqliteStore;
  let service: SiloService;
  let registry: PluginRegistry | null = null;
  let supervisor: PluginSupervisor;
  let app: Hono;
  let rootKey: string;

  const auth = () => ({ Authorization: `Bearer ${rootKey}` });
  const json = () => ({ ...auth(), "Content-Type": "application/json" });
  const at = (rev: number) => ({ ...json(), "If-Match": `"${rev}"` });

  /** Install a package: copy the directory in, and change nothing else. */
  const install = async (name: string) => {
    await fs.cp(path.join(Fixtures, name), path.join(tempDir, "plugins", name), {
      recursive: true,
    });
  };

  /** Rewrite `silo.toml`. The supervisor re-reads *this file*, so a rescan test
   *  that mutated an in-memory config would be testing something else. */
  const writeToml = async (blocks: Block[]) => {
    const lines = [`[storage]`, `driver = "sqlite"`, `path = ${JSON.stringify(tempDir)}`, ``];
    for (const block of blocks) {
      lines.push(`[[plugins]]`);
      lines.push(`name = ${JSON.stringify(block.name)}`);
      lines.push(`claims = ${JSON.stringify(block.claims ?? [])}`);
      lines.push(`timeout_ms = ${block.timeout_ms ?? 5000}`);
      lines.push(`on_error = ${JSON.stringify(block.on_error ?? "fail")}`);
      lines.push(`  [plugins.config]`);
      for (const [key, value] of Object.entries(block.config ?? {})) {
        lines.push(`  ${key} = ${JSON.stringify(value)}`);
      }
      lines.push(``);
    }
    await fs.writeFile(tomlPath, lines.join("\n"));
  };

  const reload = async (): Promise<Config> =>
    ConfigLoader.resolveDerivedDefaults(await ConfigLoader.loadConfig(tomlPath, true));

  /** Start the server over whatever `silo.toml` now says, exactly as `serve`
   *  does: load, hand the bus to the service, build the app, attach it. */
  const boot = async () => {
    const config = await reload();
    registry = await PluginRegistry.load(config, service, Logger.silent());
    service.useHooks(registry.hooks());
    supervisor = new PluginSupervisor({
      registry,
      service,
      logger: Logger.silent(),
      config,
      reload,
    });
    app = new SiloServer(service, {
      version: "test",
      authDisabled: false,
      logger: Logger.silent(),
      plugins: supervisor,
    }).build();
    registry.attach(app);
  };

  /**
   * Drive whatever is loaded, once, and report what the entry came back with.
   *
   * `entry.beforeValidate` is the only hook that may rewrite the value, so a
   * fixture reports by storing — which turns a probe made inside a worker into
   * something a test can assert on with no channel of its own. `null` means the
   * hook was **never delivered**; anything else means it was, and is whatever
   * the fixture had to say.
   */
  const probe = async (data: Record<string, unknown> = {}): Promise<string | null> => {
    const entry = await service.entries.create(scope, "probes", { title: "probe", ...data });
    return entry.data.note === undefined ? null : String(entry.data.note);
  };

  /** The same, for the fixtures that report a `ctx.fetch` result as JSON. */
  const probeFetch = async (): Promise<any> => {
    const note = await probe();
    return note === null ? null : JSON.parse(note);
  };

  const view = async (name: string) =>
    (await (await app.request(`/api/plugins/${name}`, { headers: auth() })).json()) as any;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-supervisor-"));
    tomlPath = path.join(tempDir, "silo.toml");
    await fs.mkdir(path.join(tempDir, "plugins"), { recursive: true });
    store = await SqliteStore.open(path.join(tempDir, "silo.db"));
    service = new SiloService(store, { mediaDir: path.join(tempDir, "media") });
    rootKey = await service.keys.bootstrap();
    await service.scopes.initDefaults();
    await service.collections.putSchema(scope, "probes", {
      type: "object",
      properties: { title: { type: "string" }, note: { type: "string" }, slow: { type: "boolean" } },
    });
    await service.collections.putSchema(scope, "notes", {
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

  describe("the acceptance test (§13.11)", () => {
    const probeClaims = [
      "hooks:default/prod/probes:entry.beforeValidate",
      "collections:default/prod/notes:entries:read",
    ];

    beforeEach(async () => {
      await install("prober");
      await writeToml([
        { name: "prober", config: { path: "/api/projects/default/envs/prod/collections/notes" } },
      ]);
      await boot();
    });

    /** "Install a package; confirm it executes nothing and holds no key." */
    test("an installed, listed, ungranted plugin runs and receives nothing", async () => {
      const record = await view("prober");
      expect(record.state).toBe("pending");
      expect(record.key_id).toBeNull();
      // Loaded — `pending` is not a refused start, or approving would need a
      // server that refuses to boot until it is approved (D34).
      expect(record.runtime.state).toBe("running");
      expect(await probeFetch()).toBeNull();
    }, 30000);

    /** "Approve a narrow grant; activate it; verify exactly those operations
     *  work through `ctx` and the neighbouring ones are refused." */
    test("a narrow grant takes effect with no restart, and reaches only what it names", async () => {
      const before = await view("prober");
      const granted = await app.request("/api/plugins/prober/grant", {
        method: "PUT",
        headers: at(before.rev),
        body: JSON.stringify({ claims: probeClaims }),
      });
      expect(granted.status).toBe(200);

      // Delivered, and the granted collection answers.
      expect(await probeFetch()).toEqual({ status: 200, body: expect.any(String) });

      // The neighbouring one does not. Pointed there by `PATCH .../config`,
      // which is the other half of what phase 4 owed — and it means the same
      // running plugin proves both facts.
      const current = await view("prober");
      const pointed = await app.request("/api/plugins/prober/config", {
        method: "PATCH",
        headers: at(current.rev),
        body: JSON.stringify({ path: "/api/keys" }),
      });
      expect(pointed.status).toBe(200);
      expect((await probeFetch()).status).toBe(403);
    }, 30000);

    /**
     * The sentence itself, in two steps, because the two halves must be
     * separable.
     *
     * Narrowing the grant to the hook claim alone leaves the plugin **still
     * being delivered** while its `ctx` reach is gone — which is exactly the
     * inconsistent state §13.15 refused to create by accident, produced here on
     * purpose so the test can tell it apart from a full revocation. Then the
     * revocation stops delivery too.
     */
    test("revoking live stops ctx and hook delivery, and each is provable alone", async () => {
      const before = await view("prober");
      await app.request("/api/plugins/prober/grant", {
        method: "PUT",
        headers: at(before.rev),
        body: JSON.stringify({ claims: probeClaims }),
      });
      expect((await probeFetch()).status).toBe(200);

      // Half: the API claim goes, the hook claim stays. Still delivered, no
      // longer allowed to read.
      const granted = await view("prober");
      await app.request("/api/plugins/prober/grant", {
        method: "PUT",
        headers: at(granted.rev),
        body: JSON.stringify({ claims: ["hooks:default/prod/probes:entry.beforeValidate"] }),
      });
      expect((await probeFetch()).status).toBe(403);

      // Whole: the grant goes. Not delivered at all — and the managed key is
      // gone with it, which before phase 4 was the *only* thing that happened.
      const narrowed = await view("prober");
      const revoked = await app.request("/api/plugins/prober/grant", {
        method: "DELETE",
        headers: at(narrowed.rev),
      });
      expect(revoked.status).toBe(200);
      expect((await revoked.json() as any).key_id).toBeNull();
      expect(await probeFetch()).toBeNull();

      // No restart happened anywhere in that: the same worker served all four
      // probes. If it had been torn down and rebuilt, this would be a test of
      // `PluginLoader` rather than of the authority cell.
      expect((await view("prober")).runtime.state).toBe("running");
    }, 30000);
  });

  describe("enable and disable", () => {
    beforeEach(async () => {
      await install("dawdler");
      await writeToml([
        {
          name: "dawdler",
          claims: ["hooks:*/*/*:entry.beforeValidate"],
          config: { mark: "from-file" },
        },
      ]);
      await boot();
    });

    test("disabling stops the worker now, and enabling starts it again", async () => {
      expect(await probe()).toBe("from-file");

      const running = await view("dawdler");
      const off = await app.request("/api/plugins/dawdler/disable", {
        method: "POST",
        headers: at(running.rev),
      });
      expect((await off.json() as any).runtime.state).toBe("stopped");
      expect(registry!.list()).toHaveLength(0);
      expect(await probe()).toBeNull();

      const disabled = await view("dawdler");
      const on = await app.request("/api/plugins/dawdler/enable", {
        method: "POST",
        headers: at(disabled.rev),
      });
      expect((await on.json() as any).runtime.state).toBe("running");
      expect(await probe()).toBe("from-file");
    }, 30000);

    /**
     * The ordering rule, measured.
     *
     * Enabling starts the worker **before** writing the record, so a package
     * that cannot load leaves the record saying `enabled: false`. The reverse
     * order looks harmless and is not: `PluginLoader` refuses the whole start
     * for a plugin it cannot load, so a record saying `enabled: true` for a
     * broken package turns one failed API call into a server that will not boot.
     */
    test("enabling a package that cannot load fails, and leaves the record disabled", async () => {
      const running = await view("dawdler");
      await app.request("/api/plugins/dawdler/disable", {
        method: "POST",
        headers: at(running.rev),
      });

      // Break it while nothing holds it open: the module no longer exports the
      // hook its manifest declares, which is one of the failures §13.3 refuses
      // to let pass as a warning.
      await fs.writeFile(
        path.join(tempDir, "plugins", "dawdler", "index.ts"),
        `import { defineSiloPlugin } from "silo:api";\nexport default defineSiloPlugin({});\n`
      );

      const disabled = await view("dawdler");
      const failed = await app.request("/api/plugins/dawdler/enable", {
        method: "POST",
        headers: at(disabled.rev),
      });
      expect(failed.status).toBe(500);

      // The loader's own words reach the caller. Phase 4 is the first time a
      // *caller* asks for a start, so it is the first time this failure needs a
      // shape — a plain `Error` here renders as `internal error`, discarding the
      // one sentence that says what to fix.
      const body = (await failed.json()) as any;
      expect(body.error.code).toBe("plugin_start_failed");
      expect(body.error.message).toContain("exports no such function");
      expect(body.error.details.plugin).toBe("dawdler");

      const after = await view("dawdler");
      expect(after.enabled).toBe(false);
      expect(after.rev).toBe(disabled.rev);
    }, 30000);
  });

  describe("config", () => {
    beforeEach(async () => {
      await install("dawdler");
      await writeToml([
        {
          name: "dawdler",
          claims: ["hooks:*/*/*:entry.beforeValidate"],
          config: { mark: "from-file" },
        },
      ]);
      await boot();
    });

    test("a patch restarts the plugin with the new document, and says where it came from", async () => {
      expect((await view("dawdler")).config_source).toBe("silo.toml");

      const before = await view("dawdler");
      const patched = await app.request("/api/plugins/dawdler/config", {
        method: "PATCH",
        headers: at(before.rev),
        body: JSON.stringify({ mark: "from-api" }),
      });
      expect(patched.status).toBe(200);

      const after = (await patched.json()) as any;
      expect(after.config).toEqual({ mark: "from-api" });
      // The override wins whole, and the file's block stops applying — the fact
      // that makes "this is not what my silo.toml says" a real support question,
      // which is why the source is on the view at all.
      expect(after.config_source).toBe("store");
      expect(await probe()).toBe("from-api");
    }, 30000);

    test("a null removes a key, per RFC 7396, and DELETE returns to the file", async () => {
      const before = await view("dawdler");
      await app.request("/api/plugins/dawdler/config", {
        method: "PATCH",
        headers: at(before.rev),
        body: JSON.stringify({ mark: "from-api", ms: 10 }),
      });

      const withBoth = await view("dawdler");
      expect(withBoth.config).toEqual({ mark: "from-api", ms: 10 });

      const trimmed = await app.request("/api/plugins/dawdler/config", {
        method: "PATCH",
        headers: at(withBoth.rev),
        body: JSON.stringify({ ms: null }),
      });
      expect((await trimmed.json() as any).config).toEqual({ mark: "from-api" });

      const pinned = await view("dawdler");
      const cleared = await app.request("/api/plugins/dawdler/config", {
        method: "DELETE",
        headers: at(pinned.rev),
      });
      const back = (await cleared.json()) as any;
      expect(back.config_source).toBe("silo.toml");
      expect(back.config).toEqual({ mark: "from-file" });
      expect(await probe()).toBe("from-file");
    }, 30000);

    test("a config the manifest's schema refuses changes nothing", async () => {
      const before = await view("dawdler");
      const refused = await app.request("/api/plugins/dawdler/config", {
        method: "PATCH",
        headers: at(before.rev),
        body: JSON.stringify({ nonsense: true }),
      });
      expect(refused.status).toBe(400);
      expect((await view("dawdler")).config).toEqual({ mark: "from-file" });
      expect(await probe()).toBe("from-file");
    }, 30000);

    test("configuring needs plugins:configure, which plugins:grant does not imply", async () => {
      const granter = (await service.keys.create("granter", ["plugins:grant", "plugins:read"]))
        .secret;
      const before = await view("dawdler");
      const res = await app.request("/api/plugins/dawdler/config", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${granter}`,
          "Content-Type": "application/json",
          "If-Match": `"${before.rev}"`,
        },
        body: JSON.stringify({ mark: "nope" }),
      });
      expect(res.status).toBe(403);
    }, 30000);
  });

  describe("rescan", () => {
    beforeEach(async () => {
      await install("dawdler");
      await install("slugger");
      await writeToml([
        {
          name: "dawdler",
          claims: ["hooks:*/*/*:entry.beforeValidate"],
          config: { mark: "one" },
        },
      ]);
      await boot();
    });

    const rescan = async () =>
      (await (
        await app.request("/api/plugins/rescan", { method: "POST", headers: auth() })
      ).json()) as any;

    test("a plugin added to the file starts, and one removed from it stops", async () => {
      await writeToml([
        { name: "dawdler", claims: ["hooks:*/*/*:entry.beforeValidate"], config: { mark: "one" } },
        { name: "slugger", claims: ["hooks:*/*/*:entry.beforeValidate"], config: { from: "title" } },
      ]);

      const added = await rescan();
      expect(added.started).toEqual(["slugger"]);
      expect(added.unchanged).toEqual(["dawdler"]);
      expect(added.order).toEqual(["dawdler", "slugger"]);

      await writeToml([
        { name: "slugger", claims: ["hooks:*/*/*:entry.beforeValidate"], config: { from: "title" } },
      ]);
      const removed = await rescan();
      expect(removed.stopped).toEqual(["dawdler"]);
      expect(removed.order).toEqual(["slugger"]);
      // Gone means gone: the hook it used to answer no longer fires.
      expect(await probe()).toBeNull();
    }, 30000);

    /** The array's order **is** dispatch order (§13.5), so a reorder in the
     *  file is a behaviour change and a rescan has to apply it. */
    test("reordering the file reorders dispatch", async () => {
      const both: Block[] = [
        { name: "dawdler", claims: ["hooks:*/*/*:entry.beforeValidate"], config: { mark: "one" } },
        { name: "slugger", claims: ["hooks:*/*/*:entry.beforeValidate"], config: { from: "title" } },
      ];
      await writeToml(both);
      await rescan();

      await writeToml([both[1]!, both[0]!]);
      const reordered = await rescan();
      expect(reordered.order).toEqual(["slugger", "dawdler"]);
      expect(reordered.started).toEqual([]);
      expect(reordered.restarted).toEqual([]);
      // Nothing was torn down to achieve it: reordering is not a reason to
      // throw away a worker.
      expect(reordered.unchanged.sort()).toEqual(["dawdler", "slugger"]);
    }, 30000);

    test("a changed config in the file restarts that plugin and no other", async () => {
      await writeToml([
        { name: "dawdler", claims: ["hooks:*/*/*:entry.beforeValidate"], config: { mark: "two" } },
      ]);
      const report = await rescan();
      expect(report.restarted).toEqual(["dawdler"]);
      expect(await probe()).toBe("two");
    }, 30000);

    test("a listed plugin that cannot load is reported, and the rest still apply", async () => {
      await fs.rm(path.join(tempDir, "plugins", "dawdler"), { recursive: true, force: true });
      await writeToml([
        { name: "dawdler", claims: ["hooks:*/*/*:entry.beforeValidate"], config: { mark: "one" } },
        { name: "slugger", claims: ["hooks:*/*/*:entry.beforeValidate"], config: { from: "title" } },
      ]);

      const report = await rescan();
      expect(report.failed).toHaveLength(1);
      expect(report.failed[0].name).toBe("dawdler");
      // The other one still started, which is the whole reason a rescan reports
      // failures rather than refusing itself over one of them.
      expect(report.started).toEqual(["slugger"]);
    }, 30000);

    /**
     * Found on a running instance, not by the suite — the second time in two
     * phases that has been true (D38 found its ordering bug the same way).
     *
     * `ConfigLoader` throws a plain `Error`, which the HTTP layer turns into
     * `internal error` with no detail. "Internal error" is the least useful
     * thing to say to somebody who has just mistyped a `[[plugins]]` block,
     * because the message they need is exactly the one being discarded.
     */
    test("a config file that does not parse says why, and changes nothing", async () => {
      await fs.appendFile(tomlPath, `\n[[plugins]]\nclaims = []\n`);

      const res = await app.request("/api/plugins/rescan", { method: "POST", headers: auth() });
      expect(res.status).toBe(400);
      const body = (await res.json()) as any;
      expect(body.error.message).toContain(`needs a "name"`);
      // Nothing was touched on the way to refusing: the plugin that was running
      // before is still running, and still delivered.
      expect(registry!.list().map((runtime) => runtime.name)).toEqual(["dawdler"]);
      expect(await probe()).toBe("one");
    }, 30000);

    test("rescanning needs plugins:enable", async () => {
      const reader = (await service.keys.create("reader", ["plugins:read"])).secret;
      const res = await app.request("/api/plugins/rescan", {
        method: "POST",
        headers: { Authorization: `Bearer ${reader}` },
      });
      expect(res.status).toBe(403);
    }, 30000);
  });

  describe("a dead worker", () => {
    beforeEach(async () => {
      await install("dawdler");
      await writeToml([
        {
          name: "dawdler",
          claims: ["hooks:*/*/*:entry.beforeValidate"],
          timeout_ms: 300,
          on_error: "skip",
          config: { mark: "alive", ms: 3000 },
        },
      ]);
      await boot();
    });

    /**
     * Before phase 4 this kill was permanent **and silent** — the plugin simply
     * stopped working and every surface still showed it as loaded. Reporting it
     * is what the `runtime` block is for; restarting is deliberate rather than
     * automatic, because a plugin that missed its budget is usually still
     * spinning and a respawn would walk into the same wall (§13.9).
     */
    test("is reported as failed, and a restart brings it back", async () => {
      expect(await probe()).toBe("alive");

      // One dispatch past the budget: the host gives up and tears the worker
      // down. `on_error: "skip"` keeps the write, so there is an entry to read.
      await probe({ slow: true });

      const dead = await view("dawdler");
      expect(dead.runtime.state).toBe("failed");
      expect(dead.runtime.detail).toContain("dawdler");
      expect(await probe()).toBeNull();

      const restarted = await app.request("/api/plugins/dawdler/restart", {
        method: "POST",
        headers: auth(),
      });
      expect((await restarted.json() as any).state).toBe("running");
      expect(await probe()).toBe("alive");
    }, 30000);

    test("restarting needs no If-Match, because it writes no record", async () => {
      const before = await view("dawdler");
      const res = await app.request("/api/plugins/dawdler/restart", {
        method: "POST",
        headers: auth(),
      });
      expect(res.status).toBe(200);
      expect((await view("dawdler")).rev).toBe(before.rev);
    }, 30000);
  });
  /**
   * What the management API says about a plugin granted through `silo.toml`
   * rather than through the record (D40).
   *
   * D34 made effective authority the **union** of the file and the record, and
   * the view reported only the record — so measured on a running instance, a
   * plugin answering `ctx.fetch` with a `200` was reported `state: "pending"`,
   * `granted: []`, and everything it asked for still to approve. Every one of
   * those was false, and the grant screen phase 5 builds on it would have
   * offered to approve what was already running.
   */
  describe("a grant written in silo.toml (D40)", () => {
    const probeClaims = [
      "hooks:default/prod/probes:entry.beforeValidate",
      "collections:default/prod/notes:entries:read",
    ];

    beforeEach(async () => {
      await install("prober");
      await writeToml([
        {
          name: "prober",
          claims: probeClaims,
          config: { path: "/api/projects/default/envs/prod/collections/notes" },
        },
      ]);
      await boot();
    });

    test("the record's half and the file's half are both reported", async () => {
      const record = await view("prober");
      expect(record.config_claims).toEqual(probeClaims);
      // The half the API can change is still empty — nothing was approved here.
      expect(record.granted).toEqual([]);
      // Normalized, because that is the form both grant paths are stored and
      // compared in; the file's own order is not a fact about authority.
      expect(record.effective).toEqual([...probeClaims].sort());
    }, 30000);

    test("a plugin the file granted is not reported as awaiting approval", async () => {
      // It is doing the thing. Asserted first, so the state below is being
      // compared against measured behaviour rather than against the record.
      expect(await probeFetch()).toEqual({ status: 200, body: expect.any(String) });
      expect((await view("prober")).state).toBe("granted");
    }, 30000);

    test("what it holds through the file does not read as still to approve", async () => {
      const record = await view("prober");
      for (const claim of probeClaims) expect(record.not_granted).not.toContain(claim);
    }, 30000);
  });

  /** What the package declares, which the record cannot carry (D40). The admin
   *  config form is rendered from `config_schema`, so a view without it can
   *  only offer a JSON box. */
  describe("the manifest on the view (D40)", () => {
    beforeEach(async () => {
      await install("prober");
      await writeToml([
        { name: "prober", config: { path: "/api/projects/default/envs/prod/collections/notes" } },
      ]);
      await boot();
    });

    test("the view reports what the package contributes and its config schema", async () => {
      const record = await view("prober");
      expect(record.contributes.hooks).toEqual(["entry.beforeValidate"]);
      expect(record.contributes.providers).toEqual([]);
      expect(record.contributes.runtime).toBe(false);
      expect(record.config_schema).toMatchObject({ type: "object" });
    }, 30000);

    /** The reasons are the author's, so they come from the package rather than
     *  the record — including the derived one for a declared hook (D36). */
    test("every requested claim carries a reason, derived ones included", async () => {
      const record = await view("prober");
      for (const claim of record.requested) {
        expect(record.reasons[claim]).toBeTruthy();
      }
      expect(String(record.reasons["hooks:*/*/*:entry.beforeValidate"])).toContain(
        "entry.beforeValidate"
      );
    }, 30000);

    /** The case a running plugin's own copy of the manifest cannot cover: it is
     *  not running, so the package has to be read from disk. */
    test("a plugin that is not running still declares what it is", async () => {
      const before = await view("prober");
      const stopped = await app.request("/api/plugins/prober/disable", {
        method: "POST",
        headers: at(before.rev),
      });
      expect(stopped.status).toBe(200);

      const record = await view("prober");
      expect(record.runtime.state).toBe("stopped");
      expect(record.contributes.hooks).toEqual(["entry.beforeValidate"]);
      expect(record.config_schema).toMatchObject({ type: "object" });
    }, 30000);
  });

});
