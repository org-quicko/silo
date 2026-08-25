import { SiloService } from "../../core/services/silo-service";

export class ExportCommand {
  static async run(
    service: SiloService,
    store: any,
    values: any,
    version: string
  ): Promise<void> {
    const dir = typeof values.dir === "string" ? values.dir : undefined;
    const out = typeof values.out === "string" ? values.out : undefined;
    const withKeys = !!values["with-keys"];

    if (!dir && !out) {
      console.error("must specify either --dir <path> or --out <path.tar.gz>");
      process.exit(1);
    }
    if (dir && out) {
      console.error("cannot specify both --dir and --out");
      process.exit(1);
    }

    const options = { withKeys, siloVersion: version };
    if (dir) {
      await service.transfer.exportDir(dir, options);
      console.log(`exported data to directory: ${dir}`);
    } else if (out) {
      await service.transfer.exportTarGz(out, options);
      console.log(`exported data to tarball: ${out}`);
    }
    await store.close();
  }
}
