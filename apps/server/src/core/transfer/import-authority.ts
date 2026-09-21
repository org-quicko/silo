import { SystemCollections } from "../domain/system-collections";
import type { Scope } from "../domain/scope";
import type { ExportManifest } from "./export-manifest";
import type { ImportOptions } from "./import-options";
import { MediaModes } from "./media-mode";

/**
 * What an archive is *authoritative* for — the question replace mode has to ask
 * before it empties anything.
 *
 * Replace deletes what it is about to reload, which is only safe where the
 * archive holds everything that was there. A content collection always
 * qualifies: the archive names the (scope, collection) pair, and anything else
 * in that scope is untouched (D18). `_system` does not, because nothing
 * addresses its collections by name — what rides from them is decided by the
 * media mode and by `with_keys` (§7.7). Before selections existed every archive
 * was the whole instance, so the old rule was right by accident; it stops being
 * right the moment a partial archive exists, where replacing `_media` from one
 * would delete the catalog rows for every file the archive did not happen to
 * carry.
 */
export class ImportAuthority {
  /** Whether this run is a whole archive being loaded whole. */
  static whole(manifest: ExportManifest, options: ImportOptions): boolean {
    if (options.include && !options.include.isEverything) return false;
    return !manifest.selection || manifest.selection.length === 0;
  }

  /** Whether replace mode may empty this collection before reloading it. */
  static replaces(scope: Scope, collection: string, manifest: ExportManifest, options: ImportOptions): boolean {
    if (!scope.isSystem()) return true;
    if (!ImportAuthority.whole(manifest, options)) return false;
    if (collection === SystemCollections.Media) {
      // A `referenced` archive describes only what its entries point at, so it
      // cannot stand in for the catalog. `all` and `none` both describe the
      // whole library and differ only in the bytes.
      return manifest.media?.mode !== MediaModes.Referenced;
    }
    return true;
  }

  /**
   * Whether replace mode clears the destination's **blobs** before loading.
   *
   * Stricter than `replaces` for the catalog by exactly one mode: an archive
   * taken with `media: none` is authoritative for what the library contains and
   * carries none of it, so deleting the destination's bytes on its word would
   * destroy the very files it is counting on already being there.
   */
  static clearsLibrary(manifest: ExportManifest, options: ImportOptions): boolean {
    if (options.mode !== "replace") return false;
    if (options.media === MediaModes.None) return false;
    if (!ImportAuthority.whole(manifest, options)) return false;
    return manifest.media === undefined || manifest.media.mode === MediaModes.All;
  }
}
