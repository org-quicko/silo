import type { Entry } from "../../domain/entry";

/**
 * A verified package as the planner and Apply read it (D110, D111), by the
 * source's own names. Rows come back as the package holds them, dates still
 * strings.
 */
export interface TransferPackageContent {
  schema(collection: string): Promise<unknown>;
  entry(collection: string, id: string): Promise<Entry | null>;
  /** The `_media` rows, by id. */
  assets(): Promise<Entry[]>;
  /** The `_media_folders` rows, by id. */
  folders(): Promise<Entry[]>;
  /** Where the bytes of a blob key are, by the key's name in `media/`. */
  mediaFile(blobKey: string): string;
}
