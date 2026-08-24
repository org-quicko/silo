import { describe, test, expect } from "bun:test";
import fs from "fs/promises";
import path from "path";
import { HookNames } from "../../core/hooks";
import { ProviderRegistry } from "../../plugins";
import { Assets } from "../../../create-silo-plugin/src/assets";
import { PluginContract } from "../../../create-silo-plugin/src/plugin-contract";
import { ProviderPorts } from "../../../create-silo-plugin/src/provider-ports";

const Root = path.resolve(import.meta.dir, "../../..");

/**
 * `create-silo-plugin` publishes on its own and declares **no dependencies at
 * all** — the same property the plugins it emits have, and the reason it can
 * be run with `npx` against a silo it was never installed beside. The cost is
 * that every fact it knows about silo's contract is a *copy*, and a copy that
 * drifts hands new plugin authors a manifest silo will refuse.
 *
 * This is what makes the copies honest. It lives in silo's suite rather than
 * the scaffolder's because the thing being protected is silo's contract: a
 * sixth hook added to `HookName` should fail *here*, in the change that adds
 * it, not months later in a bug report from someone whose scaffold declared a
 * hook nothing dispatches.
 */
describe("create-silo-plugin does not drift from silo's contract", () => {
  test("the silo:api types it ships are silo's own, byte for byte", async () => {
    // The README tells plugin authors to copy this file next to their plugin
    // by hand; automating that hand-copy is most of the tool's value, and a
    // stale copy would describe hooks or a `ctx` that no longer exist.
    const original = await fs.readFile(
      path.join(Root, "server/plugins/host/silo-api-types.d.ts"),
      "utf8"
    );
    const shipped = await fs.readFile(Assets.path("silo-api.d.ts"), "utf8");

    expect(shipped).toBe(original);
  });

  test("it offers exactly silo's five hooks", () => {
    // Order included: the scaffolder sorts a chosen set into this order so two
    // authors picking the same hooks get the same file, and `HookNames.All` is
    // where that order is defined.
    expect([...PluginContract.Hooks]).toEqual([...HookNames.All]);
  });

  test("every hook it offers has a summary", () => {
    expect(Object.keys(PluginContract.HookSummaries).sort()).toEqual([...PluginContract.Hooks].sort());
  });

  test("it refuses exactly the driver names silo reserves", () => {
    // Compared with silo's list as the receiver so the literal union on the
    // scaffolder's side stays assignable to it.
    expect([...ProviderRegistry.Reserved]).toEqual([...PluginContract.ReservedDrivers]);
  });

  test("it knows both provider ports and no others", async () => {
    // `ProviderPort` is a two-value union in a file of its own, so the source
    // is read rather than imported: importing the type gives nothing to
    // compare at runtime, and a third value added there must fail here.
    const source = await fs.readFile(
      path.join(Root, "server/plugins/manifest/provider-port.ts"),
      "utf8"
    );
    const declared = [...source.matchAll(/"([a-z]+)"/g)].map((match) => match[1]!);

    expect([...new Set(declared)].sort()).toEqual([...PluginContract.Ports].sort());
  });

  test("the provider checklist matches the ports, method for method", async () => {
    // A scaffolded provider throws from every method until it is written, so
    // the checklist *is* the contract as far as its author can see. Missing a
    // method means a provider that looks finished and is not; inventing one
    // means an author writing code silo will never call.
    const cases: [readonly { name: string }[], string][] = [
      [ProviderPorts.Storage, "server/core/ports/storage.ts"],
      [ProviderPorts.Blob, "server/core/ports/blob-storage.ts"],
    ];

    for (const [checklist, file] of cases) {
      const source = await fs.readFile(path.join(Root, file), "utf8");
      // Two-space indent, an identifier, an optional `?`, then `(` — which is
      // every method declaration in an interface body and nothing else. A
      // property is `name: type`, and a comment line starts with `//`.
      const methods = [...source.matchAll(/^ {2}([a-zA-Z][a-zA-Z0-9]*)\??\(/gm)].map((m) => m[1]!);

      expect({ [file]: checklist.map((method) => method.name).sort() }).toEqual({
        [file]: methods.sort(),
      });
    }
  });
});
