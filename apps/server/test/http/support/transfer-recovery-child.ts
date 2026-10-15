import type { AtomicStorage } from "../../../src/core/ports/atomic-storage";
import { TransferPair } from "./transfer-pair";

/**
 * A destination that stops partway through a transfer and waits to be killed
 * (D109, D111), for the recovery test. Run as
 * `bun transfer-recovery-child.ts <directory> <during-pull | after-files | after-commit>`.
 *
 * It prints `READY <transfer id> <destination key>` once the transfer is
 * begun, then `STOPPED` at the named point: a stalled pull, every file written
 * and no commit, or the commit landed and the record not yet told.
 */
const [directory, stop] = process.argv.slice(2);
const pair = await TransferPair.open({ directory });
await pair.seed();
const hold = (): Promise<never> => {
  console.log("STOPPED");
  return new Promise<never>(() => {});
};
if (stop === "during-pull") {
  const started = Promise.withResolvers<void>();
  const url = pair.serve(
    () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array([0x1f, 0x8b]));
            started.resolve();
          },
        }),
        { headers: { "Content-Type": "application/gzip" } }
      )
  );
  const response = await pair.prepare(pair.body({ source: { url, api_key: "key" } }), pair.destinationKey, {
    Accept: "application/x-ndjson",
  });
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let first = "";
  while (!first.includes("\n")) {
    const { value, done } = await reader.read();
    if (done) throw new Error("the prepare stream ended before its first progress report");
    first += decoder.decode(value, { stream: true });
  }
  const progress = JSON.parse(first.slice(0, first.indexOf("\n")));
  console.log(`READY ${progress.transfer.id} ${pair.destinationKey}`);
  await started.promise;
  await hold();
}

const view = (await (await pair.prepare(pair.body())).json()) as { id: string };
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
