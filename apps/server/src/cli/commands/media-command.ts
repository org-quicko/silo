import { SiloService } from "../../core/services/silo-service";

/**
 * `silo media <reconcile|rekey>` — the repairs the media catalog has (D23, D88).
 *
 * Runs against the data dir with no server, like every other CLI command, so
 * it is also the recovery path when an instance will not start. Reconcile is
 * what makes the whole design honest: it backfills records for blobs uploaded
 * before D23, finishes any deletion a crash left staged, drops records whose
 * bytes are gone, and reports bytes no record claims — without deleting them,
 * because a blob with no record is also what a half-finished upload looks
 * like.
 *
 * `rekey` is the one-off beside it: it moves assets stored under a pre-D88 key
 * onto `media/<id>`, which is what lets a bucket answer `/media/<id>` itself
 * instead of every read going through silo. Nothing depends on it having been
 * run — an old key still resolves — so it is an optimisation an operator
 * chooses, not a migration an upgrade forces.
 */
export class MediaCommand {
  static async run(
    service: SiloService,
    positionals: string[],
    values: { rewrite?: boolean } = {}
  ): Promise<void> {
    // positionals[0] is "media" — the subcommand is the one after it, same as
    // `silo keys <create|list|revoke>`.
    const sub = positionals[1];
    if (sub !== "reconcile" && sub !== "rekey") {
      console.error(`usage: silo media reconcile | silo media rekey [--rewrite]`);
      process.exit(1);
    }

    if (sub === "rekey") {
      await MediaCommand.rekey(service, values.rewrite === true);
      return;
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

  /**
   * Moves what is still on a pre-D88 key. Safe to run again, and the counts say
   * what it found rather than what it hoped for.
   */
  private static async rekey(service: SiloService, rewrite: boolean): Promise<void> {
    const response = await service.media.rekey({ rewrite });

    console.log(
      `moved ${response.moved}, rewritten ${response.rewritten}, already current ${response.current}, removed ${response.removed} old object${
        response.removed === 1 ? "" : "s"
      }`
    );

    if (!rewrite && response.current > 0) {
      // An object written before silo sent Content-Disposition has no way to
      // report that, so a run that only moves keys leaves it as it is.
      console.log(
        `
${response.current} asset${response.current === 1 ? " is" : "s are"} already on the right key and ${
          response.current === 1 ? "was" : "were"
        } not touched. If ${
          response.current === 1 ? "it was" : "they were"
        } stored before silo began sending Content-Disposition, the object still has none and nothing can detect that from outside. Run again with --rewrite to write every asset back with the headers silo sends today.`
      );
    }

    if (response.missing > 0) {
      console.log(
        `
${response.missing} asset${response.missing === 1 ? "" : "s"} named bytes the store does not hold, so ${
          response.missing === 1 ? "it was" : "they were"
        } left alone. Run "silo media reconcile" to decide what happens to ${
          response.missing === 1 ? "that record" : "those records"
        }.`
      );
    }

    if (response.failed.length > 0) {
      console.log(`
${response.failed.length} could not be moved:`);
      for (const failure of response.failed) {
        console.log(`  ${failure.id}  ${failure.reason}`);
      }
      console.log(`
Their old keys still resolve, so nothing is broken. Run again once the cause is fixed.`);
      process.exit(1);
    }
  }
}
