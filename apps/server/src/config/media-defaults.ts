import type { MediaConfig } from "./media-config";

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
   * `svg` is in the list and is the one entry with a caveat: an SVG is a
   * document that can carry script, and `/media/:id` serves it inline from
   * silo's own origin. An instance with untrusted uploaders should take it out.
   */
  static readonly Extensions: readonly string[] = [
    "jpg",
    "jpeg",
    "png",
    "gif",
    "webp",
    "avif",
    "svg",
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

  static config(): MediaConfig {
    return { base_url_target: "server", extensions: [...MediaDefaults.Extensions] };
  }
}
