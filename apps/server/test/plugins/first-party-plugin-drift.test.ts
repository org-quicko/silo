import { describe, expect, test } from "bun:test";
import fs from "fs/promises";
import path from "path";

const Root = path.resolve(import.meta.dir, "../../../..");
const Canonical = path.join(Root, "apps/server/src/plugins/host/silo-api-types.d.ts");

/**
 * The first-party packages under `plugins/` are held to the contract they
 * advertise, and `silo:api` is the whole of it.
 *
 * `create-silo-plugin-drift.test.ts` already guards the copy the *scaffolder*
 * ships. These are the copies the repo's own plugins carry, and nothing checked
 * them: `silo-plugin-observability` shipped a hand-written 49-line reduction
 * whose `SiloPluginDefinition` was a bare `[name: string]` index signature, so a
 * mistyped route key or a wrong handler arity typechecked clean, and
 * `ValidationError`/`ForbiddenError` — the documented way for a route to refuse
 * with 400 or 403 — were not declared at all.
 *
 * Byte for byte, for the reason the scaffolder's guard gives: a copy is only
 * honest while something fails when it drifts.
 */
describe("the first-party plugins do not drift from silo's contract", () => {
  const plugins = ["silo-plugin-observability", "silo-plugin-strapi-import"];

  for (const plugin of plugins) {
    test(`${plugin} carries silo's own silo:api types`, async () => {
      const original = await fs.readFile(Canonical, "utf8");
      const shipped = await fs.readFile(
        path.join(Root, "plugins", plugin, "src/types/silo-api.d.ts"),
        "utf8",
      );
      expect(shipped).toBe(original);
    });
  }
});
