import { describe, expect, test } from "bun:test";
import { PgScanGate } from "../../src/adapters/storage/postgres/pg-scan-gate";
import { PgUnavailableError } from "../../src/adapters/storage/postgres/pg-unavailable-error";
import { StorageBusyError } from "../../src/core/errors/storage-busy-error";

/** A scan that holds its slot until `finish` is called. */
function heldScan() {
  let finish!: () => void;
  const done = new Promise<void>((resolve) => (finish = resolve));
  return { finish, work: () => done.then(() => "scanned") };
}

describe("PgScanGate", () => {
  test("a pool keeps two connections out of the scans, and always gives them one", () => {
    expect(PgScanGate.forPool(10).stats()).toEqual({ scans_active: 0, scans_waiting: 0, shed: 0 });
    const small = PgScanGate.forPool(2, 0);
    const first = heldScan();
    const running = small.run(first.work);
    expect(small.stats().scans_active).toBe(1);
    first.finish();
    return running;
  });

  test("past the limit a scan waits, and past the queue it is refused as busy", async () => {
    const gate = new PgScanGate(1, 1);
    const first = heldScan();
    const second = heldScan();

    const running = gate.run(first.work);
    const queued = gate.run(second.work);
    expect(gate.stats()).toMatchObject({ scans_active: 1, scans_waiting: 1 });

    const refused = await gate.run(async () => "never").catch((error) => error);
    expect(refused).toBeInstanceOf(StorageBusyError);
    expect(refused).toBeInstanceOf(PgUnavailableError);
    expect(gate.stats().shed).toBe(1);

    first.finish();
    expect(await running).toBe("scanned");
    // The slot went straight to the waiter rather than back to the pool.
    expect(gate.stats()).toMatchObject({ scans_active: 1, scans_waiting: 0 });
    second.finish();
    expect(await queued).toBe("scanned");
    expect(gate.stats().scans_active).toBe(0);
  });

  test("a scan that fails gives its slot back", async () => {
    const gate = new PgScanGate(1, 0);
    const failed = await gate.run(async () => {
      throw new Error("bad filter");
    }).catch((error) => error.message);
    expect(failed).toBe("bad filter");
    expect(await gate.run(async () => "next")).toBe("next");
  });

  test("closing refuses the scans still waiting and every scan after", async () => {
    const gate = new PgScanGate(1, 4);
    const first = heldScan();
    const running = gate.run(first.work);
    const waiting = gate.run(async () => "never").catch((error) => error.message);

    gate.close();
    expect(await waiting).toBe("storage is shutting down");
    expect(await gate.run(async () => "never").catch((error) => error.message)).toBe(
      "storage is shutting down"
    );
    // The scan already running is not interrupted.
    first.finish();
    expect(await running).toBe("scanned");
  });
});
