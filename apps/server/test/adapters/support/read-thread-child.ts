import { SqliteStore } from "../../../src/adapters/storage/sqlite/sqlite-store";
import { Scope } from "../../../src/core/domain/scope";

/**
 * A child process for `sqlite-read-thread-liveness.test.ts`: opens a store with
 * the read thread on and awaits one threaded read, fire-and-forget like
 * `main.ts` calls `Cli.run()`. A regression prints nothing and exits 0.
 */
async function main(): Promise<void> {
  const store = await SqliteStore.open(process.argv[2], undefined, { readThread: true });
  const page = await store.list(Scope.System, "_keys", {
    filter: { op: "eq", path: "$.data.hash", value: "nothing" },
    limit: 1,
    offset: 0,
  });
  console.log(`rows: ${page.items.length}`);
  await store.close();
  console.log("closed");
}

main();
