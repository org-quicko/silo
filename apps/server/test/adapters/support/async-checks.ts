/** Waiting on things that settle in their own time, for the Postgres tests. */
export class AsyncChecks {
  /**
   * The message `pending` rejects with; fails the test if it resolves.
   *
   * In place of `expect(...).rejects`, which crashed Bun 1.4.2 on Windows
   * (a segfault, or a spin at full CPU) when it awaited a refused
   * `PgStore.open` after the conformance run. See docs/context/code-design.md.
   */
  static async refusal(pending: Promise<unknown>): Promise<string> {
    try {
      await pending;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
    throw new Error("expected a refusal, but it succeeded");
  }

  /** Resolves once `check` answers true, or fails after `timeoutMs`. */
  static async until(
    check: () => boolean | Promise<boolean>,
    timeoutMs = 3_000,
    stepMs = 25
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!(await check())) {
      if (Date.now() > deadline) throw new Error(`condition not met within ${timeoutMs}ms`);
      await Bun.sleep(stepMs);
    }
  }
}
