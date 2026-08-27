/**
 * Runs `worker` over `items`, `size` at a time. The server serializes writes
 * behind one mutex, so this buys the round trips back rather than parallel
 * writes — which on a local instance is most of the wall clock.
 */
export class TaskPool {
  static async run<T>(items: readonly T[], size: number, worker: (item: T) => Promise<void>): Promise<void> {
    let cursor = 0;
    const lanes = Array.from({ length: Math.max(1, Math.min(size, items.length)) }, async () => {
      while (cursor < items.length) {
        const item = items[cursor++] as T;
        await worker(item);
      }
    });
    await Promise.all(lanes);
  }
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------
