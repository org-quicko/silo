import type { TransferConfig } from "../../config/transfer-config";
import { TransferDefaults } from "../../config/transfer-defaults";

/**
 * The two ceilings a streamed import is held to, in bytes (D85).
 *
 * In bytes here and in megabytes in the file, the way `HttpDefaults.bytes`
 * separates the two for the listener: the code compares byte counts, the
 * operator writes a number they can picture.
 */
export class ImportLimits {
  readonly maxArchiveBytes: number;
  readonly maxExtractedBytes: number;

  constructor(maxArchiveBytes: number, maxExtractedBytes: number) {
    this.maxArchiveBytes = maxArchiveBytes;
    this.maxExtractedBytes = maxExtractedBytes;
  }

  static of(config: TransferConfig): ImportLimits {
    return new ImportLimits(
      TransferDefaults.bytes(config.max_archive_size_mb),
      TransferDefaults.bytes(config.max_extracted_size_mb)
    );
  }

  /** A byte count as the megabytes a refusal names, since that is the unit the
   *  setting it points at is written in. */
  static megabytes(bytes: number): number {
    return Math.round(bytes / (1024 * 1024));
  }
}
