import fs from "fs/promises";
import path from "path";
import { FsLayout } from "../../../adapters/storage/fs/fs-layout";
import type { Entry } from "../../domain/entry";
import { Scope } from "../../domain/scope";
import { MediaCatalog } from "../../media/media-catalog";
import { MediaPaths } from "../../media/media-paths";
import type { TransferPackageContent } from "../plan/transfer-package-content";

/**
 * A prepared transfer's verified package on disk (D109), read by the source's
 * names: its content under the source scope, its media rows under `_system`,
 * its bytes in `media/`. Only what the verifier accepted is ever here.
 */
export class PreparedTransferPackage implements TransferPackageContent {
  private readonly directory: string;
  private readonly from: { project: string; env: string };

  constructor(directory: string, from: { project: string; env: string }) {
    this.directory = directory;
    this.from = from;
  }

  async schema(collection: string): Promise<unknown> {
    return JSON.parse(await fs.readFile(path.join(this.scope(), "schemas", `${collection}${FsLayout.SchemaSuffix}`), "utf8"));
  }

  async entry(collection: string, id: string): Promise<Entry | null> {
    try {
      return JSON.parse(await fs.readFile(path.join(this.scope(), "content", collection, `${id}.json`), "utf8")) as Entry;
    } catch (caught: any) {
      if (caught?.code === "ENOENT") return null;
      throw caught;
    }
  }

  assets(): Promise<Entry[]> {
    return this.rows(MediaCatalog.Collection);
  }

  folders(): Promise<Entry[]> {
    return this.rows(MediaCatalog.FoldersCollection);
  }

  mediaFile(blobKey: string): string {
    return path.join(this.directory, "media", MediaPaths.archiveName(blobKey));
  }

  private scope(): string {
    return path.join(this.directory, "projects", this.from.project, this.from.env);
  }

  /** One media collection's rows, by id; none when the package carries no media. */
  private async rows(collection: string): Promise<Entry[]> {
    const directory = path.join(this.directory, "projects", Scope.System.project, Scope.System.env, "content", collection);
    let names: string[];
    try {
      names = (await fs.readdir(directory)).filter((name) => name.endsWith(".json")).sort();
    } catch (caught: any) {
      if (caught?.code === "ENOENT") return [];
      throw caught;
    }
    const rows: Entry[] = [];
    for (const name of names) rows.push(JSON.parse(await fs.readFile(path.join(directory, name), "utf8")) as Entry);
    return rows;
  }
}
