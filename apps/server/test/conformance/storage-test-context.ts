import type { Entry } from "../../src/core/domain/entry";
import { EntryUtils } from "../../src/core/domain/entry-utils";
import { Scope } from "../../src/core/domain/scope";
import { MediaRefs } from "../../src/core/media/media-refs";
import type { Storage } from "../../src/core/ports/storage";
import { SearchText } from "../../src/core/search/search-text";

/**
 * The store under test, plus the fixtures every conformance suite builds on.
 *
 * One instance is shared by all the suites in a run, so each test starts from a
 * freshly opened store rather than from whatever the previous one left behind.
 */
export class StorageTestContext {
  private readonly open: () => Promise<Storage>;
  private readonly cleanup: (store: Storage) => Promise<void>;
  private current: Storage | null = null;

  constructor(open: () => Promise<Storage>, cleanup: (store: Storage) => Promise<void>) {
    this.open = open;
    this.cleanup = cleanup;
  }

  /** Discards the previous store and opens a new one. */
  async fresh(): Promise<Storage> {
    if (this.current) await this.cleanup(this.current);
    this.current = await this.open();
    return this.current;
  }

  /** Writes an entry with a deterministic timestamp `seconds` into 2026-01-01,
   *  so sort order is fixed without any test having to say so. */
  async putEntry(
    store: Storage,
    scope: Scope,
    collection: string,
    seconds: number,
    data: any
  ): Promise<Entry> {
    const timestamp = new Date(Date.UTC(2026, 0, 1, 0, 0, seconds));
    const entry: Entry = {
      id: EntryUtils.newID(),
      project: scope.project,
      env: scope.env,
      collection,
      rev: 1,
      seq: 0,
      created_at: timestamp,
      updated_at: timestamp,
      data,
    };
    await store.put(entry, {
      usages: MediaRefs.extract(entry.data),
      search: SearchText.extract(entry.data),
    });
    return entry;
  }

  titles(items: Entry[]): string[] {
    return items.map((item) => item.data.title);
  }

  /**
   * Three posts the filter and sort suites share.
   *
   * Only alpha carries a subtitle, so the presence operators have something to
   * separate; only alpha is nested twice, so the wildcard chain has something
   * to recurse through.
   */
  async seed(store: Storage, scope: Scope = Scope.Default) {
    const alpha = await this.putEntry(store, scope, "posts", 1, {
      title: "alpha",
      views: 10,
      tags: ["go", "cms"],
      author: { name: "nina" },
      subtitle: "first",
      matrix: [[1, 2], [3]],
    });
    const beta = await this.putEntry(store, scope, "posts", 2, {
      title: "beta",
      views: 25,
      tags: ["go", "db"],
      author: { name: "omar" },
    });
    const gamma = await this.putEntry(store, scope, "posts", 3, {
      title: "gamma",
      views: 3,
      tags: [],
      author: { name: "nina" },
      blocks: [{ kind: "para" }, { kind: "quote" }],
    });
    return { alpha, beta, gamma };
  }
}
