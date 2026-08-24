import { Service } from "../../core/service/service";

/**
 * `silo search reindex [--check]` — the standing repair for the search index
 * (D30), and the counterpart to `silo media reconcile`.
 *
 * It runs against the data dir with no server, like every other CLI command,
 * so it is also the recovery path when an instance will not start. A rebuild
 * is always safe: the index is derived state, so the worst a rebuild costs is
 * time.
 */
export class SearchCommand {
  static async run(svc: Service, positionals: string[], values: any): Promise<void> {
    // positionals[0] is "search" — the subcommand is the one after it, same as
    // `silo media reconcile`.
    const sub = positionals[1];
    if (sub !== "reindex") {
      console.error(`usage: silo search reindex [--check]`);
      process.exit(1);
    }

    const engine = svc.searchCapabilities().engine;
    if (engine !== "fts5") {
      // Not an error: an un-indexed instance searches by scanning, so there is
      // simply nothing to rebuild. Saying which engine is in use is more
      // useful than a silent success.
      console.log(
        `search is running on the "${engine}" engine, which keeps no index — nothing to rebuild.\n` +
          `Set [search] enabled = true on a SQLite instance whose build has FTS5 to get one.`
      );
      return;
    }

    const report = await svc.reindexSearch();
    console.log(
      `reindexed ${report.entries} entr${report.entries === 1 ? "y" : "ies"} in ${report.collections} collection${
        report.collections === 1 ? "" : "s"
      }`
    );

    if (!values.check) return;

    const integrity = svc.checkSearch();
    if (!integrity) return;

    // Two checks, because FTS5's own compares the index against its content
    // table and is blind to a document whose entry has gone.
    console.log(`\nintegrity:`);
    console.log(`  fts index vs documents : ${integrity.index}`);
    console.log(`  documents with no entry: ${integrity.orphanDocuments}`);
    console.log(`  entries with no document: ${integrity.missingDocuments}`);
    if (
      integrity.index !== "ok" ||
      integrity.orphanDocuments > 0 ||
      integrity.missingDocuments > 0
    ) {
      console.log(`\nWARNING: the index disagrees with the entries it describes.`);
      process.exitCode = 1;
    }
  }
}
