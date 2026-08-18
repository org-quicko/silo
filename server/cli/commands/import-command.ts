import fs from "fs/promises";
import { Service } from "../../core/service/service";

export class ImportCommand {
  static async run(
    svc: Service,
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
    const opts = { mode, validate, dryRun, prefer, allowKeys: true };

    let res;
    const stat = await fs.stat(src);
    if (stat.isDirectory()) {
      res = await svc.importDir(src, opts);
    } else {
      res = await svc.importTarGz(src, opts);
    }

    if (dryRun) {
      console.log(`Dry-run results for ${src}:`);
    } else {
      console.log(`Import completed successfully for ${src}:`);
    }
    console.log(`  Added:   ${res.added}`);
    console.log(`  Updated: ${res.updated}`);
    console.log(`  Deleted: ${res.deleted}`);
    console.log(`  Skipped: ${res.skipped}`);

    await store.close();
  }
}
