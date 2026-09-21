import { SiloService } from "../../core/services/silo-service";
import { MediaModes } from "../../core/transfer/media-mode";
import { TransferSelection } from "../../core/transfer/transfer-selection";

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

    const include = TransferSelection.parse(
      Array.isArray(values.include) ? values.include : values.include ? [values.include] : []
    );
    const media = MediaModes.parse(values.media, !include.isEverything);
    const options = { withKeys, siloVersion: version, include, media };

    if (dir) {
      const manifest = await service.transfer.exportDir(dir, options);
      console.log(`exported data to directory: ${dir}`);
      ExportCommand.report(manifest);
    } else if (out) {
      // The tarball is written as it is walked, so there is no manifest to
      // report back without reading the archive again; the selection the
      // operator asked for is what there is to echo.
      await service.transfer.exportTarGz(out, options);
      console.log(`exported data to tarball: ${out}`);
      console.log(`  Covering: ${include.isEverything ? "the whole instance" : include.describe().join(", ")}`);
      console.log(`  Media:    ${media}`);
    }
    await store.close();
  }

  private static report(manifest: {
    collections?: Record<string, number>;
    selection?: string[];
    media?: { mode: string; referenced: number; catalogued: number; files: number };
  }): void {
    const collections = Object.keys(manifest.collections ?? {}).length;
    const entries = Object.values(manifest.collections ?? {}).reduce((sum, count) => sum + count, 0);
    console.log(`  Covering:    ${manifest.selection ? manifest.selection.join(", ") : "the whole instance"}`);
    console.log(`  Collections: ${collections}`);
    console.log(`  Entries:     ${entries}`);
    if (manifest.media) {
      console.log(
        `  Media:       ${manifest.media.mode} — ${manifest.media.files} file(s), ${manifest.media.catalogued} catalogued, ${manifest.media.referenced} referenced`
      );
    }
  }
}
