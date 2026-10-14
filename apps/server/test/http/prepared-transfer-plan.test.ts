import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Claims } from "@silo/shared/claims";
import { Scope } from "../../src/core/domain/scope";
import { TransferPair } from "./support/transfer-pair";

/** A response body as JSON, untyped: each assertion says what it holds. */
const read = async (response: { json(): Promise<unknown> } | Promise<{ json(): Promise<unknown> }>): Promise<any> =>
  (await response).json();

/**
 * The plan a prepared transfer holds (D110): each packaged entry decided by
 * the importer's rules against the destination environment, checked against
 * the schema the transfer leaves in place, and shown to a reader only as far
 * as the reader may see into the destination.
 */
describe("prepared transfer plan", () => {
  let pair: TransferPair;
  const uat = Scope.of("acme", "uat");

  beforeEach(async () => {
    pair = await TransferPair.open();
    await pair.seed();
  });

  afterEach(async () => {
    await pair.close();
  });

  const plant = (...args: Parameters<TransferPair["plant"]>) => pair.plant(...args);

  /** Each line as "id action destination-rev", sorted, so a test reads what it expects. */
  const lines = (items: any[]) =>
    items.map((item) => [item.id ?? "hidden", item.action, item.destination?.rev ?? "-"].join(" ")).sort();

  test("decides each entry as an import does, against the destination environment only", async () => {
    const { picked, other, home } = pair.seeded;
    await pair.destinationService.collections.putSchema(uat, "posts", { type: "object" });
    await plant("uat", "posts", picked, "2020-01-01T00:00:00Z");
    await plant("uat", "posts", other, "2100-01-01T00:00:00Z");
    // The same page in another environment of the destination is not in the way.
    await pair.destinationService.collections.putSchema(Scope.of("acme", "dev"), "pages", { type: "object" });
    await plant("dev", "pages", home, "2100-01-01T00:00:00Z");

    const cases: [string | undefined, string, string][] = [
      [undefined, "updated", "skipped"],
      ["remote", "updated", "updated"],
      ["local", "skipped", "skipped"],
    ];
    for (const [prefer, pickedAction, otherAction] of cases) {
      const view = await read(
        pair.prepare(pair.body({ selection: [{ collection: "posts" }, { collection: "pages" }], prefer, media: "none" }))
      );
      expect([prefer, lines(view.entries.items)]).toEqual([
        prefer,
        [`${home} added -`, `${other} ${otherAction} 1`, `${picked} ${pickedAction} 1`].sort(),
      ]);
      expect(view.review.collections.map((collection: any) => [collection.collection, collection.schema])).toEqual([
        ["pages", "create"],
        ["posts", "unchanged"],
      ]);
    }
  });

  test("checks entries against the schema the transfer leaves in place", async () => {
    const body = (overrides: Record<string, unknown> = {}) =>
      pair.body({ selection: [{ collection: "posts" }], media: "none", ...overrides });
    await pair.destinationService.collections.putSchema(uat, "posts", {
      type: "object",
      properties: { title: { type: "number" } },
    });

    // The package's looser schema replaces the empty collection's, so it decides.
    const taken = await read(pair.prepare(body()));
    expect(taken.review).toMatchObject({ added: 2, rejected: 0, collections: [{ collection: "posts", schema: "update" }] });

    // Kept, the destination's schema decides: it refuses the new entry's
    // title, and does not judge the one the destination keeps.
    const { picked, other } = pair.seeded;
    await plant("uat", "posts", other, "2100-01-01T00:00:00Z");
    const kept = await read(pair.prepare(body({ prefer: "local" })));
    expect(kept.review).toMatchObject({ added: 0, skipped: 1, rejected: 1, collections: [{ collection: "posts", schema: "unchanged" }] });
    expect(kept.entries.items.find((item: any) => item.id === picked)).toMatchObject({
      action: "rejected",
      reason: expect.stringContaining("/title"),
    });

    // Now that the collection holds an entry its schema is frozen (D70), and the plan fails.
    const refused = await pair.prepare(body());
    expect(refused.status).toBe(409);
    expect((await read(refused)).error.message).toContain("its schema cannot change");
    expect((await pair.transferDirectories()).sort()).toEqual([taken.id, kept.id].sort());
  });

  test("replace counts every destination row, and names one only to a key that may read it", async () => {
    const { picked, other } = pair.seeded;
    await pair.destinationService.collections.putSchema(uat, "posts", { type: "object" });
    await plant("uat", "posts", picked, "2100-01-01T00:00:00Z", 7);
    const extra = (await pair.destinationService.entries.create(uat, "posts", { title: "only here" })).id;

    const claims = (permissions: typeof Claims.ScopeCopyReadPermissions) =>
      permissions.map((permission) => Claims.collection("acme", "uat", "posts", permission));
    const writer = [Claims.TransferCopy, ...claims(Claims.ScopeCopyWritePermissions), ...claims(Claims.ScopeCopyReplacePermissions)];
    const cases: [string, string[], string[]][] = [
      ["writer", writer, [`${other} added -`, `${picked} added -`, "hidden deleted -"]],
      [
        "reader",
        [...writer, ...claims(Claims.ScopeCopyReadPermissions)],
        [`${other} added -`, `${picked} added 7`, `${extra} deleted 1`],
      ],
    ];
    for (const [name, granted, expected] of cases) {
      const key = (await pair.destinationService.keys.create(name, granted)).secret;
      const view = await read(pair.prepare(pair.body({ mode: "replace", selection: [{ collection: "posts" }], media: "none" }), key));
      expect(view.review.collections).toEqual([
        { collection: "posts", schema: "update", added: 2, updated: 0, deleted: 2, skipped: 0, rejected: 0 },
      ]);
      const again = await read(pair.call("GET", `${TransferPair.Prepare}/${view.id}`, key));
      expect([name, lines(view.entries.items), lines(again.entries.items)]).toEqual([name, expected.sort(), expected.sort()]);
      expect(JSON.stringify(again)).not.toContain('"seq"');
    }
  });
});
