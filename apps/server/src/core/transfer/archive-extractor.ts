import fs from "fs";
import { Unpack } from "tar";
import { ArchiveTooLargeError } from "../errors/archive-too-large-error";
import { ImportLimits } from "./import-limits";

/**
 * `tar.x` with a disk budget (D85).
 *
 * A gzip archive says nothing about its size until it is inflated, and a
 * 128 MB upload can inflate to over a hundred gigabytes onto the disk the
 * database shares. tar hands every header to a `filter` before it writes the
 * entry, and a header states the entry's size, so the budget is spent there:
 * each entry costs its stated size or one filesystem block, whichever is
 * larger, plus its 512-byte header — which also bounds an archive of a million
 * empty files, where the cost is inodes rather than bytes. The first entry that
 * would overspend aborts the whole extraction before it is written, so the
 * budget is never exceeded on disk.
 *
 * The parser is driven by hand rather than through `tar.x`, because `x` keeps
 * the `Unpack` it builds to itself and aborting one is the whole point.
 */
export class ArchiveExtractor {
  static readonly HeaderBytes = 512;
  static readonly BlockBytes = 4096;

  /** What one entry is charged against the budget. */
  static cost(size: number): number {
    return ArchiveExtractor.HeaderBytes + Math.max(size, ArchiveExtractor.BlockBytes);
  }

  static extract(file: string, destination: string, limits?: ImportLimits): Promise<void> {
    let spent = 0;
    let refusal: ArchiveTooLargeError | null = null;

    const unpack = new Unpack({
      cwd: destination,
      filter: (_path, entry) => {
        if (!limits) return true;
        spent += ArchiveExtractor.cost(entry.size ?? 0);
        if (spent <= limits.maxExtractedBytes) return true;
        refusal ??= new ArchiveTooLargeError(
          `archive expands past ${ImportLimits.megabytes(limits.maxExtractedBytes)} MB; ` +
            `raise [transfer] max_extracted_size_mb to load it`
        );
        unpack.abort(refusal);
        return false;
      },
    });

    return new Promise<void>((resolve, reject) => {
      const source = fs.createReadStream(file);
      // tar's abort decorates the error it was handed and emits it, so the
      // refusal comes back as itself; anything else is the parser's own.
      const fail = (caught: unknown) => {
        source.destroy();
        reject(refusal ?? caught);
      };
      unpack.on("error", fail);
      unpack.on("close", () => (refusal ? reject(refusal) : resolve()));
      source.on("error", fail);
      source.pipe(unpack as unknown as NodeJS.WritableStream);
    });
  }
}
