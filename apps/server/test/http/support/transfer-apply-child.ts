import type { AtomicStorage } from "../../../src/core/ports/atomic-storage";
import { TransferPair } from "./transfer-pair";

/**
 * A destination that stops partway through an apply and waits to be killed
 * (D111), for the recovery test. Run as
 * `bun transfer-apply-child.ts <directory> <after-files | after-commit>`.
 *
 * It prints `READY <transfer id> <destination key>` once the transfer is
 * prepared, then `STOPPED` when the apply reaches the named point: every file
 * written and no commit, or the commit landed and the record not yet told.
 */
const [directory, stop] = process.argv.slice(2);
const pair = await TransferPair.open({ directory });
await pair.seed();
const view = (await (await pair.prepare(pair.body())).json()) as { id: string };

const hold = (): Promise<never> => {
  console.log("STOPPED");
  return new Promise<never>(() => {});
};
if (stop === "after-files") {
  const blobs = pair.destinationService.blobStorage;
  const put = blobs.put.bind(blobs);
  blobs.put = async (...args) => {
    await put(...args);
    return hold();
  };
} else {
  const store = pair.destinationService.store as AtomicStorage;
  const commit = store.commit.bind(store);
  store.commit = async (changes) => {
    await commit(changes);
    return hold();
  };
}
console.log(`READY ${view.id} ${pair.destinationKey}`);
await pair.apply(view.id);
