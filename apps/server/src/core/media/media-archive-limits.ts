import type { MediaConfig } from "../../config/media-config";
import { MediaDefaults } from "../../config/media-defaults";

/** The ceilings `[media]` sets on one bulk download, in force right now. */
export interface MediaDownloadCeilings {
  maxFiles: number;
  maxBytes: number;
  maxStreams: number;
}

/**
 * The bounds on a bulk download (D106). The part size, the selection size and
 * the ticket rules are fixed: the part keeps every zip under ZIP's 4 GiB, and
 * a whole-library copy is `silo export`'s job. The rest come from `[media]`.
 */
export class MediaArchiveLimits {
  /** A part closes before it passes this, as Google Drive splits at 2 GB.
   *  A single file larger than this is downloaded on its own instead. */
  static readonly PartBytes = 2 * 1024 ** 3;
  /** Selected ids plus selected folders in one request. */
  static readonly MaxSelection = 1_000;
  static readonly TicketLifetimeMs = 60 * 60 * 1000;
  static readonly MaxTickets = 32;

  static of(config: MediaConfig): MediaDownloadCeilings {
    const defaults = MediaDefaults.downloads();
    return {
      maxFiles: config.download_max_files ?? defaults.download_max_files,
      maxBytes: (config.download_max_size_mb ?? defaults.download_max_size_mb) * 1024 * 1024,
      maxStreams: config.download_max_streams ?? defaults.download_max_streams,
    };
  }
}
