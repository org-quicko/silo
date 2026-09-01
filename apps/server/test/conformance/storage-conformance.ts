import { describe } from "bun:test";
import type { Storage } from "../../src/core/ports/storage";
import { StorageTestContext } from "./storage-test-context";
import { EntrySuite } from "./suites/entry-suite";
import { MediaUsageSuite } from "./suites/media-usage-suite";
import { QuerySuite } from "./suites/query-suite";
import { RenameSuite } from "./suites/rename-suite";
import { SafetySuite } from "./suites/safety-suite";
import { SchemaSuite } from "./suites/schema-suite";
import { ScopeExistenceSuite } from "./suites/scope-existence-suite";
import { ScopeIsolationSuite } from "./suites/scope-isolation-suite";

/**
 * The behaviour every `Storage` adapter owes, run against each of them.
 *
 * A port with two implementations is only a port if both answer the same
 * questions the same way, so this suite is the contract — `fs.test.ts` and
 * `sqlite.test.ts` do nothing but point it at their adapter.
 */
export function runStorageTestSuite(
  name: string,
  open: () => Promise<Storage>,
  cleanup: (store: Storage) => Promise<void>
) {
  describe(`Storage Conformance: ${name}`, () => {
    const context = new StorageTestContext(open, cleanup);

    SchemaSuite.register(context);
    EntrySuite.register(context);
    QuerySuite.register(context);
    ScopeExistenceSuite.register(context);
    ScopeIsolationSuite.register(context);
    RenameSuite.register(context);
    SafetySuite.register(context);
    MediaUsageSuite.register(context);
  });
}
