import type { Dirent } from "fs";
import fs from "fs/promises";
import { ValidationError } from "@silo/shared/validation-error";
import { EntryUtils } from "../../domain/entry-utils";

/** One directory of a package, by name. */
export interface TransferPackageListing {
  files: Set<string>;
  directories: Set<string>;
}

/**
 * Reads an unpacked package for its verifier (D109), and refuses anything a
 * silo never writes into one.
 *
 * Only plain files and folders are accepted. A package can come from any
 * server, and a symbolic link in it could name any file on this host: reading
 * through one would hand that file to the review, or to Apply, as content. So
 * the listing's own file types decide, and a link is never followed.
 */
export class TransferPackageTree {
  /** A directory's files and folders. An absent directory is an empty one. */
  static async read(directory: string, label: string): Promise<TransferPackageListing> {
    let dirents: Dirent[];
    try {
      dirents = await fs.readdir(directory, { withFileTypes: true });
    } catch (caught: any) {
      if (caught?.code === "ENOENT") return { files: new Set(), directories: new Set() };
      throw caught;
    }
    const listing: TransferPackageListing = { files: new Set(), directories: new Set() };
    for (const dirent of dirents) {
      if (dirent.isFile()) listing.files.add(dirent.name);
      else if (dirent.isDirectory()) listing.directories.add(dirent.name);
      else throw TransferPackageTree.refuse(`${label}/${dirent.name} is not a plain file or folder`);
    }
    return listing;
  }

  /** Refuses the first name in `found` that `allowed` does not hold. */
  static only(found: Iterable<string>, allowed: ReadonlySet<string>, label: string): void {
    for (const name of found) {
      if (!allowed.has(name)) throw TransferPackageTree.refuse(`${label}/${name} was not asked for`);
    }
  }

  /** A JSON file's document, or a refusal naming the file. */
  static async json(file: string, label: string): Promise<any> {
    try {
      return JSON.parse(await fs.readFile(file, "utf8"));
    } catch {
      throw TransferPackageTree.refuse(`${label} is not valid JSON`);
    }
  }

  /** The id an entry file names, checked the way every storage adapter checks one. */
  static entryId(name: string, label: string): string {
    if (!name.endsWith(".json")) throw TransferPackageTree.refuse(`${label}/${name} is not an entry`);
    const id = name.slice(0, -".json".length);
    try {
      EntryUtils.assertSafeSegment(id, "entry id");
    } catch {
      throw TransferPackageTree.refuse(`${label}/${name} does not name a valid entry id`);
    }
    if (id.startsWith(".")) throw TransferPackageTree.refuse(`${label}/${name} does not name a valid entry id`);
    return id;
  }

  /** An entry file's document: an object whose `id` is the one its name gives. */
  static async entry(file: string, id: string, label: string): Promise<Record<string, any>> {
    const document = await TransferPackageTree.json(file, label);
    const valid =
      document !== null &&
      typeof document === "object" &&
      document.id === id &&
      Number.isInteger(document.rev) &&
      TransferPackageTree.isInstant(document.created_at) &&
      TransferPackageTree.isInstant(document.updated_at) &&
      document.data !== null &&
      typeof document.data === "object" &&
      !Array.isArray(document.data);
    if (!valid) throw TransferPackageTree.refuse(`${label} is not a valid entry`);
    return document;
  }

  static refuse(problem: string): ValidationError {
    return new ValidationError(`the source sent a package this server cannot accept: ${problem}`);
  }

  private static isInstant(value: unknown): boolean {
    return typeof value === "string" && !Number.isNaN(Date.parse(value));
  }
}
