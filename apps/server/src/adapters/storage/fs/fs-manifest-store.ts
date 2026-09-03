import fs from "fs/promises";
import path from "path";
import { EntryUtils } from "../../../core/domain/entry-utils";
import type { Meta } from "../../../core/domain/meta";
import { FormatVersion } from "../../../core/transfer/format-version";
import { FsFiles } from "./fs-files";
import type { FsLayout } from "./fs-layout";
import type { FsManifest } from "./fs-manifest";

/**
 * `manifest.json`: the instance id and the `seq` high-water mark.
 *
 * `last_seq` is held in memory and written back on every entry write, which is
 * what lets this adapter stay CAS-free — the guard against two processes over
 * one data directory is at the process boundary instead (D25).
 */
export class FsManifestStore {
  private readonly layout: FsLayout;
  private readonly metadata: Meta;

  private constructor(layout: FsLayout, metadata: Meta) {
    this.layout = layout;
    this.metadata = metadata;
  }

  /**
   * Reads and validates the manifest **before** creating anything, so a
   * refused pre-D18 directory is left exactly as found rather than gaining a
   * stray `projects/` on the way to being rejected.
   */
  static async open(layout: FsLayout): Promise<FsManifestStore> {
    const raw = await FsManifestStore.readRaw(layout.manifestFile);

    let manifest: FsManifest;
    if (raw === undefined) {
      manifest = {
        format_version: FormatVersion,
        instance_id: EntryUtils.newID(),
        last_seq: 0,
        defaults_initialized: false,
      };
      await fs.mkdir(layout.projectsDir, { recursive: true });
      await FsFiles.writeAtomic(layout.manifestFile, JSON.stringify(manifest, null, 2));
    } else {
      manifest = JSON.parse(raw) as FsManifest;
      // A pre-D18 data dir stamps format_version "1" (flat layout). Reading it
      // as the new projects/<p>/<e>/… tree would silently find nothing instead
      // of failing loudly, so refuse it up front.
      if (manifest.format_version !== FormatVersion) {
        throw new Error(
          `this data directory uses format_version "${manifest.format_version}"; export with the previous binary and re-import, or start from a fresh data dir`
        );
      }
      await fs.mkdir(layout.projectsDir, { recursive: true });
    }

    const store = new FsManifestStore(layout, {
      instance_id: manifest.instance_id,
      last_seq: manifest.last_seq,
      defaults_initialized: manifest.defaults_initialized === true,
    });
    await store.repairFromDisk();
    return store;
  }

  get meta(): Meta {
    return this.metadata;
  }

  /** Reserves the next `seq` and persists the new high-water mark. */
  async nextSeq(): Promise<number> {
    this.metadata.last_seq++;
    await this.write();
    return this.metadata.last_seq;
  }

  /**
   * Raises `last_seq` to whatever the tree actually holds.
   *
   * A data directory can arrive by `rsync` or `git checkout` with entries
   * newer than the manifest that travelled with it; without this, the next
   * write would reissue a `seq` that already exists.
   */
  private async repairFromDisk(): Promise<void> {
    const maxSeq = await FsManifestStore.scanMaxSeq(this.layout.projectsDir);
    if (maxSeq <= this.metadata.last_seq) return;

    this.metadata.last_seq = maxSeq;
    await this.write();
  }

  /** Idempotent, and persisted rather than derived: "no projects exist" would
   *  reseed the default the moment the last one is deleted or renamed (D51). */
  async markDefaultsInitialized(): Promise<void> {
    if (this.metadata.defaults_initialized) return;
    this.metadata.defaults_initialized = true;
    await this.write();
  }

  private async write(): Promise<void> {
    const manifest: FsManifest = {
      format_version: FormatVersion,
      instance_id: this.metadata.instance_id,
      last_seq: this.metadata.last_seq,
      defaults_initialized: this.metadata.defaults_initialized,
    };
    await FsFiles.writeAtomic(this.layout.manifestFile, JSON.stringify(manifest, null, 2));
  }

  private static async readRaw(manifestFile: string): Promise<string | undefined> {
    try {
      return await fs.readFile(manifestFile, "utf8");
    } catch (error: any) {
      if (error.code !== "ENOENT") throw error;
      return undefined;
    }
  }

  /** The highest `seq` in any entry file under `dir`. Corrupt files are
   *  skipped — a torn write must not stall a start. */
  private static async scanMaxSeq(dir: string): Promise<number> {
    let maxSeq = 0;

    for (const entry of await FsFiles.readDirents(dir)) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        maxSeq = Math.max(maxSeq, await FsManifestStore.scanMaxSeq(full));
        continue;
      }
      if (!entry.name.endsWith(".json")) continue;

      const parsed = await FsFiles.readJsonOrNull(full);
      if (parsed && typeof parsed.seq === "number" && parsed.seq > maxSeq) {
        maxSeq = parsed.seq;
      }
    }
    return maxSeq;
  }
}
