import { Claims } from "@silo/shared/claims";
import { ValidationError } from "@silo/shared/validation-error";
import { EntryUtils } from "../../domain/entry-utils";
import type { Scope } from "../../domain/scope";
import { MediaModes, type MediaMode } from "../media-mode";
import type { TransferPackageCollection } from "./transfer-package-collection";

/**
 * What a transfer package carries, checked whole before anything is read
 * (D108): one scope, named collections, and `referenced` or `none` media.
 *
 * Exact by construction. A name or id that is malformed, repeated or reserved
 * is a `400` here, and one that does not exist is refused before the first
 * byte, so a package is never wider or narrower than what was asked for.
 */
export class TransferPackageSelection {
  readonly scope: Scope;
  readonly collections: readonly TransferPackageCollection[];
  readonly media: MediaMode;

  private constructor(scope: Scope, collections: TransferPackageCollection[], media: MediaMode) {
    this.scope = scope;
    this.collections = collections;
    this.media = media;
  }

  /** From a request body: `{collections: [{name, entry_ids?}], media?}`. */
  static parse(scope: Scope, body: unknown): TransferPackageSelection {
    if (scope.isSystem()) throw new ValidationError("the system scope cannot be packaged");
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new ValidationError("invalid body: want {collections: [{name, entry_ids?}], media?}");
    }
    const { collections, media } = body as { collections?: unknown; media?: unknown };
    return new TransferPackageSelection(
      scope,
      TransferPackageSelection.collections(collections),
      TransferPackageSelection.media(media)
    );
  }

  private static collections(value: unknown): TransferPackageCollection[] {
    if (!Array.isArray(value) || value.length === 0) {
      throw new ValidationError("collections must be a non-empty array");
    }
    const seen = new Set<string>();
    return value.map((item) => {
      const { name, entry_ids } = (item ?? {}) as { name?: unknown; entry_ids?: unknown };
      if (typeof name !== "string" || !Claims.isCollectionName(name) || name.startsWith("_")) {
        throw new ValidationError(`invalid collection name ${JSON.stringify(name)}`);
      }
      if (seen.has(name)) throw new ValidationError(`collection "${name}" is named twice`);
      seen.add(name);
      if (entry_ids === undefined) return { name };
      return { name, entryIds: TransferPackageSelection.entryIds(name, entry_ids) };
    });
  }

  private static entryIds(collection: string, value: unknown): string[] {
    if (!Array.isArray(value) || value.length === 0) {
      throw new ValidationError(`entry_ids for "${collection}" must be a non-empty array`);
    }
    for (const id of value) {
      if (typeof id !== "string") throw new ValidationError(`entry_ids for "${collection}" must be strings`);
      EntryUtils.assertSafeSegment(id, "entry id");
    }
    if (new Set(value).size !== value.length) {
      throw new ValidationError(`entry_ids for "${collection}" name an entry twice`);
    }
    return value as string[];
  }

  /** `all` is refused: a package carries what its entries use, never the library. */
  private static media(value: unknown): MediaMode {
    if (value === undefined) return MediaModes.Referenced;
    if (value === MediaModes.Referenced || value === MediaModes.None) return value as MediaMode;
    throw new ValidationError(`invalid media mode ${JSON.stringify(value)}: want "referenced" or "none"`);
  }
}
