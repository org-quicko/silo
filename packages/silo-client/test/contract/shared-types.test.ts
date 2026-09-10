import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { FilterOperators } from "../../src/query/filter-operator";

/**
 * The client's filter vocabulary against silo's own.
 *
 * The client declares its own wire types on purpose, so nothing here imports
 * `@silo/shared` at the type level. What matters is that the two do not
 * diverge: an operator silo accepts and the client cannot build is a query a
 * consumer has to hand-write, and one the client offers and silo refuses is a
 * `400` nobody can act on.
 *
 * `@silo/shared` is a dev-only workspace dependency, so this skips whenever it
 * is not linked and the package still tests standalone. The specifier is built
 * at runtime so `tsc` does not try to resolve a module that may be absent.
 */

const SharedRoot = join(import.meta.dir, "../../../shared");
const SharedPresent = existsSync(join(SharedRoot, "src/query/filter-ops.ts"));

interface LeafOperator {
  op: string;
}

interface FilterOpsModule {
  FilterOps: { Leaf: readonly LeafOperator[]; Group: readonly string[] };
}

async function loadServerOperators(): Promise<string[]> {
  const specifier = join(SharedRoot, "src/query/filter-ops.ts");
  const module = (await import(specifier)) as FilterOpsModule;
  return [...module.FilterOps.Leaf.map((leaf) => leaf.op), ...module.FilterOps.Group];
}

describe.skipIf(!SharedPresent)("filter vocabulary against @silo/shared", () => {
  test("offers every operator silo accepts, and no other", async () => {
    const server = await loadServerOperators();
    const offered: string[] = [...FilterOperators];
    expect(offered.sort()).toEqual(server.sort());
  });
});
