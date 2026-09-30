import type { MediaConfig, MediaDownloadField } from "./media-config";

/**
 * What `[media]` means when a file does not say (D46).
 *
 * Here rather than on `MediaExtensions` because `config/` is a leaf layer: the
 * policy class in `core/media` holds the *behaviour*, and the values a new
 * instance starts from are configuration like every other default in `§10`.
 */
export class MediaDefaults {
  /**
   * What a new instance accepts: images, video, audio and PDF.
   *
   * Media types only, because that is what a media library is for and a
   * default that also took `.docx` would be guessing at a use nobody stated.
   * Adding to it is one field on the settings page.
   *
   * `svg` is deliberately absent (D83). An SVG is an XML document that can
   * carry script, and the 2026-09-18 audit showed one uploaded with a
   * `write`-preset key running on the admin's origin. `/media/{id}` now serves
   * one as an attachment inside a sandbox, so adding `svg` back is safe where
   * every uploader is trusted — and it is the operator's call, not the default.
   */
  static readonly Extensions: readonly string[] = [
    "jpg",
    "jpeg",
    "png",
    "gif",
    "webp",
    "avif",
    "ico",
    "bmp",
    "mp4",
    "webm",
    "mov",
    "mp3",
    "wav",
    "ogg",
    "m4a",
    "pdf",
  ];

  /**
   * Each bulk download ceiling's default and the range it accepts (D106).
   * Files stop well short of ZIP's 65,535 entries; the size is split into
   * 2 GiB parts whatever it is.
   */
  static readonly Downloads: Readonly<Record<MediaDownloadField, { value: number; min: number; max: number }>> = {
    download_max_files: { value: 5_000, min: 1, max: 50_000 },
    download_max_size_mb: { value: 5 * 1024, min: 1, max: 1024 * 1024 },
    download_max_streams: { value: 3, min: 1, max: 32 },
  };

  static config(): MediaConfig {
    return {
      extensions: [...MediaDefaults.Extensions],
      ...MediaDefaults.downloads(),
    };
  }

  static downloads(): Record<MediaDownloadField, number> {
    return {
      download_max_files: MediaDefaults.Downloads.download_max_files.value,
      download_max_size_mb: MediaDefaults.Downloads.download_max_size_mb.value,
      download_max_streams: MediaDefaults.Downloads.download_max_streams.value,
    };
  }

  /** `value` as a ceiling for `field`: a whole number in its range, or `undefined`. */
  static download(field: MediaDownloadField, value: unknown): number | undefined {
    const { min, max } = MediaDefaults.Downloads[field];
    return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : undefined;
  }
}
