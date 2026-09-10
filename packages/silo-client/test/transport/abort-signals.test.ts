import { describe, expect, test } from "bun:test";
import { AbortSignals } from "../../src/transport/abort-signals";

describe("AbortSignals", () => {
  test("never aborts when neither source fires", () => {
    const abortSignals = new AbortSignals(undefined, undefined);
    expect(abortSignals.signal.aborted).toBe(false);
    expect(abortSignals.firedBy()).toBeUndefined();
    abortSignals.dispose();
  });

  test("reports the caller when the caller's signal aborts", () => {
    const controller = new AbortController();
    const abortSignals = new AbortSignals(controller.signal, 10_000);

    controller.abort();

    expect(abortSignals.signal.aborted).toBe(true);
    expect(abortSignals.firedBy()).toBe("caller");
    abortSignals.dispose();
  });

  test("reports the caller when the signal is already aborted at construction", () => {
    const controller = new AbortController();
    controller.abort();

    const abortSignals = new AbortSignals(controller.signal, undefined);

    expect(abortSignals.signal.aborted).toBe(true);
    expect(abortSignals.firedBy()).toBe("caller");
    abortSignals.dispose();
  });

  test("reports the timeout when the deadline elapses first", async () => {
    const abortSignals = new AbortSignals(undefined, 5);

    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(abortSignals.signal.aborted).toBe(true);
    expect(abortSignals.firedBy()).toBe("timeout");
    abortSignals.dispose();
  });

  test("only the first source to fire is reported", async () => {
    const controller = new AbortController();
    const abortSignals = new AbortSignals(controller.signal, 5);

    await new Promise((resolve) => setTimeout(resolve, 30));
    controller.abort();

    expect(abortSignals.firedBy()).toBe("timeout");
    abortSignals.dispose();
  });

  test("dispose clears the timer so a late deadline never fires", async () => {
    const abortSignals = new AbortSignals(undefined, 5);
    abortSignals.dispose();

    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(abortSignals.signal.aborted).toBe(false);
    expect(abortSignals.firedBy()).toBeUndefined();
  });

  test("dispose removes the caller listener so a late abort is not reported", () => {
    const controller = new AbortController();
    const abortSignals = new AbortSignals(controller.signal, undefined);
    abortSignals.dispose();

    controller.abort();

    expect(abortSignals.signal.aborted).toBe(false);
    expect(abortSignals.firedBy()).toBeUndefined();
  });
});
