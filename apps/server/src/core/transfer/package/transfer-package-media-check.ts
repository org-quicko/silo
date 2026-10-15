import path from "path";
import { FsLayout } from "../../../adapters/storage/fs/fs-layout";
import type { Entry } from "../../domain/entry";
import { Scope } from "../../domain/scope";
import { MediaCatalog } from "../../media/media-catalog";
import { MediaPaths } from "../../media/media-paths";
import { TransferPackageTree } from "./transfer-package-tree";

/**
 * The media half of a package's verification (D109): exactly the closure the
 * packaged entries reference, as the source's `TransferPackageMedia` cuts it.
 *
 * Every asset row must answer for a reference some packaged entry holds and be
 * active. Every file under `media/` must belong to a row, every row must have
 * its file, and the file's size and sha256 must be the row's. Every folder row
 * must sit above a carried asset. What the rows leave unresolved must be the
 * package's `missing_media`, no more and no less.
 */
export class TransferPackageMediaCheck {
  private static readonly Collections = new Set<string>([MediaCatalog.Collection, MediaCatalog.FoldersCollection]);

  static async verify(
    directory: string,
    referenced: ReadonlySet<string>
  ): Promise<{ assets: number; folders: number; missing: string[] }> {
    const scope = path.join(directory, "projects", Scope.System.project, Scope.System.env);
    await TransferPackageMediaCheck.layout(directory, scope);

    const blobs = await TransferPackageTree.read(path.join(directory, "media"), "media");
    TransferPackageTree.only(blobs.directories, new Set(), "media");

    const resolved = new Set<string>();
    const ancestors = new Set<string>();
    const claimed = new Set<string>();
    const assets = await TransferPackageMediaCheck.rows(scope, MediaCatalog.Collection, async (id, row, label) => {
      const asset = MediaCatalog.toAsset(row as Entry);
      const tokens = MediaCatalog.tokens(id, asset.blob_key);
      if (!tokens.some((token) => referenced.has(token))) {
        throw TransferPackageTree.refuse(`${label} is not used by any packaged entry`);
      }
      if (row.data.state !== "active") throw TransferPackageTree.refuse(`${label} is not an active asset`);
      const name = TransferPackageMediaCheck.blobName(asset.blob_key, label);
      if (claimed.has(name)) throw TransferPackageTree.refuse(`${label} shares its file with another asset`);
      if (!blobs.files.has(name)) throw TransferPackageTree.refuse(`${label} has no file in media/`);
      claimed.add(name);

      const file = Bun.file(path.join(directory, "media", name));
      if (file.size !== asset.size || (await TransferPackageMediaCheck.sha256(file)) !== asset.hash) {
        throw TransferPackageTree.refuse(`media/${name} is not the file ${label} describes`);
      }
      for (const token of tokens) resolved.add(token);
      for (const folder of MediaPaths.ancestors(TransferPackageMediaCheck.folder(asset.folder, label))) {
        ancestors.add(folder);
      }
    });
    TransferPackageTree.only(blobs.files, claimed, "media");

    const seen = new Set<string>();
    const folders = await TransferPackageMediaCheck.rows(scope, MediaCatalog.FoldersCollection, async (_id, row, label) => {
      const folder = TransferPackageMediaCheck.folder(MediaCatalog.folderOf(row as Entry), label);
      if (!ancestors.has(folder) || seen.has(folder)) {
        throw TransferPackageTree.refuse(`${label} is not a folder above a packaged asset`);
      }
      seen.add(folder);
    });

    const missing = [...referenced].filter((token) => !resolved.has(token)).sort();
    return { assets, folders, missing };
  }

  /** `_system/_system` holds the two media collections' schemas and rows, and nothing else. */
  private static async layout(directory: string, scope: string): Promise<void> {
    const projects = path.join(directory, "projects", Scope.System.project);
    const top = await TransferPackageTree.read(projects, "projects/_system");
    TransferPackageTree.only(top.files, new Set(), "projects/_system");
    TransferPackageTree.only(top.directories, new Set([Scope.System.env]), "projects/_system");

    const label = "projects/_system/_system";
    const inside = await TransferPackageTree.read(scope, label);
    TransferPackageTree.only(inside.files, new Set(), label);
    TransferPackageTree.only(inside.directories, new Set(["schemas", "content"]), label);

    const schemas = await TransferPackageTree.read(path.join(scope, "schemas"), `${label}/schemas`);
    const allowed = new Set<string>();
    for (const collection of TransferPackageMediaCheck.Collections) {
      allowed.add(`${collection}${FsLayout.SchemaSuffix}`);
      allowed.add(`.${collection}${FsLayout.CollectionMarkerSuffix}`);
    }
    TransferPackageTree.only(schemas.files, allowed, `${label}/schemas`);
    TransferPackageTree.only(schemas.directories, new Set(), `${label}/schemas`);

    const content = await TransferPackageTree.read(path.join(scope, "content"), `${label}/content`);
    TransferPackageTree.only(content.files, new Set(), `${label}/content`);
    TransferPackageTree.only(content.directories, TransferPackageMediaCheck.Collections, `${label}/content`);
    for (const collection of content.directories) {
      if (!schemas.files.has(`${collection}${FsLayout.SchemaSuffix}`)) {
        throw TransferPackageTree.refuse(`${label}/content/${collection} has no schema`);
      }
    }
  }

  /** Visits each row of one media collection, and answers how many there were. */
  private static async rows(
    scope: string,
    collection: string,
    visit: (id: string, row: Record<string, any>, label: string) => Promise<void>
  ): Promise<number> {
    const directory = path.join(scope, "content", collection);
    const label = `projects/_system/_system/content/${collection}`;
    const listing = await TransferPackageTree.read(directory, label);
    TransferPackageTree.only(listing.directories, new Set(), label);
    for (const name of listing.files) {
      const id = TransferPackageTree.entryId(name, label);
      await visit(id, await TransferPackageTree.entry(path.join(directory, name), id, `${label}/${name}`), `${label}/${name}`);
    }
    return listing.files.size;
  }

  /** The file a blob key names in `media/`: one plain name, never a path. */
  private static blobName(key: string, label: string): string {
    const name = MediaPaths.archiveName(key);
    if (!name || name.startsWith(".") || /[/\\\0]/.test(name) || name === "..") {
      throw TransferPackageTree.refuse(`${label} names an invalid blob key`);
    }
    return name;
  }

  /** A folder path as the catalog stores one: already normalised. */
  private static folder(value: string, label: string): string {
    let normalized: string;
    try {
      normalized = MediaPaths.normalizeFolder(value);
    } catch {
      throw TransferPackageTree.refuse(`${label} names an invalid folder`);
    }
    if (normalized !== value) throw TransferPackageTree.refuse(`${label} names an invalid folder`);
    return value;
  }

  private static async sha256(file: Blob): Promise<string> {
    const hasher = new Bun.CryptoHasher("sha256");
    for await (const chunk of file.stream()) hasher.update(chunk);
    return hasher.digest("hex");
  }
}
