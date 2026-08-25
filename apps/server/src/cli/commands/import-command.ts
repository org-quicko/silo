import fs from "fs/promises";
import { SiloService } from "../../core/services/silo-service";

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
    const validate = !!values.validate;
    const dryRun = !!values["dry-run"];
    const prefer = values.prefer as "local" | "remote";

    // Host-level CLI access is trusted and retains the ability to restore keys.
    const options = { mode, validate, dryRun, prefer, allowKeys: true };

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

    await store.close();
  }
}
