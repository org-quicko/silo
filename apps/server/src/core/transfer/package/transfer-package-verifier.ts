import path from "path";
import { FsLayout } from "../../../adapters/storage/fs/fs-layout";
import { Scope } from "../../domain/scope";
import { MediaRefs } from "../../media/media-refs";
import { MediaModes } from "../media-mode";
import type { PackagedEntry } from "./packaged-entry";
import { TransferPackageFormat } from "./transfer-package-format";
import { TransferPackageMediaCheck } from "./transfer-package-media-check";
import type { TransferPackageSelection } from "./transfer-package-selection";
import type { TransferPackageSummary } from "./transfer-package-summary";
import { TransferPackageTree } from "./transfer-package-tree";

/**
 * Checks an unpacked package against the selection it was asked for (D109),
 * before anything in it is planned or shown.
 *
 * Exact, not tolerant. The package must hold every requested collection and
 * entry and nothing else: no other scope, collection, entry or system row, and
 * media only as `TransferPackageMediaCheck` allows. Its `package.json` must
 * agree with what was counted. Any difference refuses the whole package, so a
 * source that is not a silo of this version, or that sends more than it was
 * asked for, never reaches the review.
 */
export class TransferPackageVerifier {
  static async verify(
    directory: string,
    selection: TransferPackageSelection
  ): Promise<{ summary: TransferPackageSummary; entries: PackagedEntry[] }> {
    const withMedia = selection.media === MediaModes.Referenced;
    const top = await TransferPackageTree.read(directory, "package");
    if (!top.files.has(TransferPackageFormat.Manifest)) {
      throw TransferPackageTree.refuse("it has no package.json; the source needs silo 1.6.0 or later");
    }
    const manifest = await TransferPackageTree.json(path.join(directory, TransferPackageFormat.Manifest), "package.json");
    TransferPackageVerifier.assertManifest(manifest, selection);
    TransferPackageTree.only(top.files, new Set([TransferPackageFormat.Manifest]), "package");
    TransferPackageTree.only(top.directories, new Set(withMedia ? ["projects", "media"] : ["projects"]), "package");

    const { project, env } = selection.scope;
    const projects = await TransferPackageTree.read(path.join(directory, "projects"), "projects");
    TransferPackageTree.only(projects.files, new Set(), "projects");
    TransferPackageTree.only(projects.directories, new Set(withMedia ? [project, Scope.System.project] : [project]), "projects");
    const projectListing = await TransferPackageTree.read(path.join(directory, "projects", project), `projects/${project}`);
    TransferPackageTree.only(projectListing.files, new Set([FsLayout.ProjectMarker]), `projects/${project}`);
    TransferPackageTree.only(projectListing.directories, new Set([env]), `projects/${project}`);
    if (!projectListing.directories.has(env)) throw TransferPackageTree.refuse(`it does not hold ${project}/${env}`);

    const referenced = new Set<string>();
    const entries = await TransferPackageVerifier.scope(directory, selection, manifest, referenced);
    const media = withMedia
      ? await TransferPackageMediaCheck.verify(directory, referenced)
      : { assets: 0, folders: 0, missing: [] as string[] };
    const declaredMissing = [...manifest.missing_media].sort();
    if (
      manifest.media_assets !== media.assets ||
      manifest.media_folders !== media.folders ||
      declaredMissing.join("\n") !== media.missing.join("\n")
    ) {
      throw TransferPackageTree.refuse("its package.json does not describe the media it holds");
    }

    const summary: TransferPackageSummary = {
      created_at: manifest.created_at,
      silo_version: manifest.silo_version,
      instance_id: manifest.instance_id,
      collections: manifest.collections.map((item: { name: string; entries: number }) => ({ name: item.name, entries: item.entries })),
      media_assets: media.assets,
      media_folders: media.folders,
      missing_media: media.missing,
    };
    return { summary, entries };
  }

  /** The scope's schemas and entries, each collection exactly as selected. */
  private static async scope(
    directory: string,
    selection: TransferPackageSelection,
    manifest: any,
    referenced: Set<string>
  ): Promise<PackagedEntry[]> {
    const label = `projects/${selection.scope.project}/${selection.scope.env}`;
    const root = path.join(directory, "projects", selection.scope.project, selection.scope.env);
    const listing = await TransferPackageTree.read(root, label);
    TransferPackageTree.only(listing.files, new Set([FsLayout.EnvMarker]), label);
    TransferPackageTree.only(listing.directories, new Set(["schemas", "content"]), label);

    const names = selection.collections.map((item) => item.name);
    const schemas = await TransferPackageTree.read(path.join(root, "schemas"), `${label}/schemas`);
    const allowed = new Set(names.flatMap((name) => [`${name}${FsLayout.SchemaSuffix}`, `.${name}${FsLayout.CollectionMarkerSuffix}`]));
    TransferPackageTree.only(schemas.files, allowed, `${label}/schemas`);
    TransferPackageTree.only(schemas.directories, new Set(), `${label}/schemas`);
    const content = await TransferPackageTree.read(path.join(root, "content"), `${label}/content`);
    TransferPackageTree.only(content.files, new Set(), `${label}/content`);
    TransferPackageTree.only(content.directories, new Set(names), `${label}/content`);

    const entries: PackagedEntry[] = [];
    for (const item of [...selection.collections].sort((left, right) => left.name.localeCompare(right.name))) {
      const schema = `${label}/schemas/${item.name}${FsLayout.SchemaSuffix}`;
      if (!schemas.files.has(`${item.name}${FsLayout.SchemaSuffix}`)) throw TransferPackageTree.refuse(`${schema} is missing`);
      const document = await TransferPackageTree.json(path.join(directory, schema), schema);
      if (document === null || typeof document !== "object" || Array.isArray(document)) {
        throw TransferPackageTree.refuse(`${schema} is not a schema`);
      }

      const folder = `${label}/content/${item.name}`;
      const files = await TransferPackageTree.read(path.join(directory, folder), folder);
      TransferPackageTree.only(files.directories, new Set(), folder);
      const ids = [...files.files].map((name) => TransferPackageTree.entryId(name, folder)).sort();
      if (item.entryIds && ids.join("\n") !== [...item.entryIds].sort().join("\n")) {
        throw TransferPackageTree.refuse(`${folder} does not hold exactly the entries asked for`);
      }
      const declared = manifest.collections.find((each: { name: string }) => each.name === item.name);
      if (declared.entries !== ids.length) throw TransferPackageTree.refuse(`its package.json miscounts ${folder}`);

      for (const id of ids) {
        const entry = await TransferPackageTree.entry(path.join(directory, folder, `${id}.json`), id, `${folder}/${id}.json`);
        for (const token of MediaRefs.extract(entry.data)) referenced.add(token);
        entries.push({ collection: item.name, id, rev: entry.rev, updated_at: entry.updated_at });
      }
    }
    return entries;
  }

  /** `package.json` names this version, this scope, this media mode and this selection. */
  private static assertManifest(manifest: any, selection: TransferPackageSelection): void {
    if (manifest === null || typeof manifest !== "object") throw TransferPackageTree.refuse("package.json is not an object");
    if (manifest.package_version !== TransferPackageFormat.Version) {
      throw TransferPackageTree.refuse(
        `it is package_version ${JSON.stringify(manifest.package_version)} and this server reads ${TransferPackageFormat.Version}`
      );
    }
    const strings = ["created_at", "silo_version", "instance_id"].every((field) => typeof manifest[field] === "string");
    const counts = ["media_assets", "media_folders"].every((field) => Number.isInteger(manifest[field]));
    const missing = Array.isArray(manifest.missing_media) && manifest.missing_media.every((token: unknown) => typeof token === "string");
    const scope = manifest.scope?.project === selection.scope.project && manifest.scope?.env === selection.scope.env;
    if (!strings || !counts || !missing || !scope || manifest.media !== selection.media) {
      throw TransferPackageTree.refuse("its package.json does not describe this request");
    }
    if (!TransferPackageVerifier.sameCollections(manifest.collections, selection)) {
      throw TransferPackageTree.refuse("its package.json names other collections or entries than were asked for");
    }
  }

  private static sameCollections(declared: unknown, selection: TransferPackageSelection): boolean {
    if (!Array.isArray(declared) || declared.length !== selection.collections.length) return false;
    return selection.collections.every((item) => {
      const match = declared.find((each) => each?.name === item.name);
      if (!match || !Number.isInteger(match.entries) || match.entries < 0) return false;
      if (!item.entryIds) return match.entry_ids === undefined;
      return Array.isArray(match.entry_ids) && [...match.entry_ids].sort().join("\n") === [...item.entryIds].sort().join("\n");
    });
  }
}
