import { SiloService } from "../../core/services/silo-service";

/**
 * `silo media reconcile` — the standing repair for the media catalog (D23).
 *
 * Runs against the data dir with no server, like every other CLI command, so
 * it is also the recovery path when an instance will not start. Reconcile is
 * what makes the whole design honest: it backfills records for blobs uploaded
 * before D23, finishes any deletion a crash left staged, drops records whose
 * bytes are gone, and reports bytes no record claims — without deleting them,
 * because a blob with no record is also what a half-finished upload looks
 * like.
 */
export class MediaCommand {
  static async run(service: SiloService, positionals: string[]): Promise<void> {
    // positionals[0] is "media" — the subcommand is the one after it, same as
    // `silo keys <create|list|revoke>`.
    const sub = positionals[1];
    if (sub !== "reconcile") {
      console.error(`usage: silo media reconcile [flags]`);
      process.exit(1);
    }

    const response = await service.media.reconcile();
    console.log(
      `adopted ${response.adopted}, pruned ${response.pruned}, finished ${response.finished} pending deletion${
        response.finished === 1 ? "" : "s"
      }`
    );
    if (response.aborted > 0) {
      // The one transition out of `deleting` that is not a deletion, so it is
      // stated plainly rather than folded into the counts above: an asset the
      // operator asked to delete is usable again.
      console.log(
        `\nreturned ${response.aborted} asset${response.aborted === 1 ? "" : "s"} to active — the blob store refused to delete ${
          response.aborted === 1 ? "it" : "them"
        }, so ${response.aborted === 1 ? "it is" : "they are"} usable again rather than stuck mid-delete. Check the blob store's credentials and permissions, then delete again if that was still the intent.`
      );
    }
    if (response.pending > 0) {
      console.log(
        `\nWARNING: ${response.pending} asset${response.pending === 1 ? "" : "s"} could not be deleted or returned to active — storage rejected both. ${
          response.pending === 1 ? "It stays" : "They stay"
        } staged and will refuse new references.`
      );
    }
    if (response.orphans.length > 0) {
      console.log(`\n${response.orphans.length} orphaned blob${response.orphans.length === 1 ? "" : "s"} (not deleted):`);
      for (const key of response.orphans) {
        console.log(`  ${key}`);
      }
    }
  }
}
