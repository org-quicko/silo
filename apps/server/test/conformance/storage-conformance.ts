import { afterAll, describe } from "bun:test";
import type { Storage } from "../../src/core/ports/storage";
import { StorageTestContext } from "./storage-test-context";
import { CommitSuite } from "./suites/commit-suite";
import { EntrySuite } from "./suites/entry-suite";
import { MediaUsageSuite } from "./suites/media-usage-suite";
import { QuerySuite } from "./suites/query-suite";
import { QueryTypesSuite } from "./suites/query-types-suite";
import { RenameSuite } from "./suites/rename-suite";
import { SafetySuite } from "./suites/safety-suite";
import { SchemaSuite } from "./suites/schema-suite";
import { ScopeExistenceSuite } from "./suites/scope-existence-suite";
import { ScopeIsolationSuite } from "./suites/scope-isolation-suite";

/**
 * The behaviour every `Storage` adapter owes, run against each of them.
 *
 * A port with several implementations is only a port if they all answer the
 * same questions the same way, so this suite is the contract — `fs.test.ts`,
 * `sqlite.test.ts` and `postgres.test.ts` point it at their adapter.
 *
 * `atomic` says the adapter offers `AtomicStorage.commit` (D107), so its
 * contract is run too. It is the caller's statement, not read off the store,
 * so an adapter that loses `commit` fails here instead of skipping.
 */
export function runStorageTestSuite(
  name: string,
  open: () => Promise<Storage>,
  cleanup: (store: Storage) => Promise<void>,
  capabilities: { atomic?: boolean } = {}
) {
  describe(`Storage Conformance: ${name}`, () => {
    const context = new StorageTestContext(open, cleanup);
    afterAll(() => context.dispose());

    SchemaSuite.register(context);
    EntrySuite.register(context);
    QuerySuite.register(context);
    QueryTypesSuite.register(context);
    ScopeExistenceSuite.register(context);
    ScopeIsolationSuite.register(context);
    RenameSuite.register(context);
    SafetySuite.register(context);
    MediaUsageSuite.register(context);
    if (capabilities.atomic) CommitSuite.register(context);
  });
}
