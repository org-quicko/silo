import fs from "fs/promises";
import { SiloService } from "../../core/services/silo-service";
import { ImportGrants } from "../../core/transfer/import-grants";
import { MediaModes } from "../../core/transfer/media-mode";
import { TransferSelection } from "../../core/transfer/transfer-selection";

export class ImportCommand {
  static async run(
    service: SiloService,
    store: any,
    positionals: string[],
    values: any
  ): Promise<void> {
    const src = positionals[1];
    if (!src) {
      console.error("usage: silo import <dir|tarball>");
      process.exit(1);
    }

    const mode = values.mode as "merge" | "replace";
    const dryRun = !!values["dry-run"];
    const prefer = values.prefer as "local" | "remote";

    const include = TransferSelection.parse(
      Array.isArray(values.include) ? values.include : values.include ? [values.include] : []
    );
    const media = MediaModes.parse(values.media, !include.isEverything);

    // Host-level CLI access is trusted: it restores keys, the media catalog and
    // every project's variables, since whoever runs it already holds the store.
    const options = { mode, dryRun, prefer, include, media, grants: ImportGrants.Trusted };

    let response;
    const stat = await fs.stat(src);
    if (stat.isDirectory()) {
      response = await service.transfer.importDir(src, options);
    } else {
      response = await service.transfer.importTarGz(src, options);
    }

    if (dryRun) {
      console.log(`Dry-run results for ${src}:`);
    } else {
      console.log(`Import completed successfully for ${src}:`);
    }
    console.log(`  Added:   ${response.added}`);
    console.log(`  Updated: ${response.updated}`);
    console.log(`  Deleted: ${response.deleted}`);
    console.log(`  Skipped: ${response.skipped}`);
    if (response.media) {
      console.log(
        `  Media:   ${response.media.files} file(s)${response.media.cleared ? " (library cleared first)" : ""}`
      );
    }

    // Last, and only when there are any: a clean import should not end on a
    // zero that invites a search for a problem that is not there.
    if (response.rejected > 0) {
      console.log(`  Rejected: ${response.rejected} (did not match the destination's schema)`);
      for (const rejection of response.rejections) {
        console.log(
          `    ${rejection.project}/${rejection.env}/${rejection.collection}/${rejection.id}: ${rejection.reason}`
        );
      }
      if (response.rejections.length < response.rejected) {
        console.log(`    … and ${response.rejected - response.rejections.length} more`);
      }
    }

    await store.close();
  }
}
