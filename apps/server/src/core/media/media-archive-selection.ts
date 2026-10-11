import { ValidationError } from "@silo/shared/validation-error";
import { MediaArchiveLimits } from "./media-archive-limits";
import { MediaPaths } from "./media-paths";

/** What a bulk download asks for: asset ids and folder paths, each folder whole. */
export class MediaArchiveSelection {
  readonly ids: string[];
  readonly folders: string[];

  private constructor(ids: string[], folders: string[]) {
    this.ids = ids;
    this.folders = folders;
  }

  /** From a request body `{ids?, folders?}`: deduplicated, folders normalised, never empty. */
  static parse(body: unknown): MediaArchiveSelection {
    const raw = (body ?? {}) as { ids?: unknown; folders?: unknown };
    const ids = MediaArchiveSelection.strings(raw.ids, "ids");
    const folders = MediaArchiveSelection.strings(raw.folders, "folders").map((folder, index) => {
      const normalized = MediaPaths.normalizeFolder(folder);
      if (!normalized) throw new ValidationError(`"folders[${index}]" must name a folder, not the library root`);
      return normalized;
    });

    const selection = new MediaArchiveSelection([...new Set(ids)], [...new Set(folders)]);
    const count = selection.ids.length + selection.folders.length;
    if (count === 0) throw new ValidationError("select at least one file or folder");
    if (count > MediaArchiveLimits.MaxSelection) {
      throw new ValidationError(`select at most ${MediaArchiveLimits.MaxSelection} files and folders at once`);
    }
    return selection;
  }

  private static strings(value: unknown, field: string): string[] {
    if (value === undefined) return [];
    if (!Array.isArray(value)) throw new ValidationError(`"${field}" must be an array of strings`);
    return value.map((item, index) => {
      if (typeof item !== "string" || !item.trim()) {
        throw new ValidationError(`"${field}[${index}]" must be a non-empty string`);
      }
      return item;
    });
  }
}
